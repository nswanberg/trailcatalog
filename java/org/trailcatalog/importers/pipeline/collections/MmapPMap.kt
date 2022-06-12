package org.trailcatalog.importers.pipeline.collections

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.io.EncodedInputStream
import org.trailcatalog.importers.pipeline.io.EncodedOutputStream
import org.trailcatalog.importers.pipeline.progress.longProgress
import java.io.File
import java.io.RandomAccessFile
import java.nio.channels.FileChannel
import java.nio.channels.FileChannel.MapMode
import java.util.PriorityQueue
import java.util.concurrent.atomic.AtomicInteger

var HEAP_DUMP_THRESHOLD = 256 * 1024 * 1024

class MmapPMap<K : Comparable<K>, V>(
    private val maps: List<EncodedInputStream>,
    private val keySerializer: Serializer<K>,
    private val valueSerializer: Serializer<V>,
    private val size: Long,
    private val fileReference: FileReference,
) : PMap<K, V> {

  var shard = 0

  override fun close() {
    maps.forEach { it.close() }
    fileReference.close()
  }

  override fun estimatedByteSize(): Long {
    return size
  }

  override fun hasNext(): Boolean {
    return shard < maps.size
  }

  override fun next(): PEntry<K, V> {
    val buffer = maps[shard]
    val key = keySerializer.read(buffer)
    val count = buffer.readVarInt()
    val list = ArrayList<V>()
    repeat(count) {
      list.add(valueSerializer.read(buffer))
    }

    while (shard < maps.size && !maps[shard].hasRemaining()) {
      shard += 1
    }

    return PEntry(key, list)
  }
}

fun <K : Comparable<K>, V : Any> createMmapPMap(
    context: String,
    keyType: TypeToken<K>,
    valueType: TypeToken<out V>,
    handles: AtomicInteger,
    fn: (Emitter2<K, V>) -> Unit): () -> MmapPMap<K, V> {
  if (handles.get() == 0) throw RuntimeException("${keyType} => ${valueType}")
  val keySerializer = getSerializer(keyType)
  val valueSerializer = getSerializer(valueType)

  val (shardedFile, shards) =
      emitToSortedShards(context, keyType, valueType, keySerializer, valueSerializer, fn)
  return mergeSortedShards(
      context, keyType, valueType, shards, keySerializer, valueSerializer, handles).also {
    shards.forEach { it.close() }
    shardedFile.delete()
  }
}

private fun <K : Comparable<K>, V : Any> emitToSortedShards(
    context: String,
    keyType: TypeToken<K>,
    valueType: TypeToken<out V>,
    keySerializer: Serializer<K>,
    valueSerializer: Serializer<V>,
    fn: (Emitter2<K, V>) -> Unit): Pair<File, List<EncodedInputStream>> {
  val sharded =
      File.createTempFile(cleanFilename("mmap-map-sharded-${keyType}-${valueType}"), null)
  sharded.deleteOnExit()
  val shards = RandomAccessFile(sharded, "rw").use {
    val stream = EncodedOutputStream(it.channel)
    val runtime = Runtime.getRuntime()
    val maxMemory = runtime.maxMemory()
    stream.use { output ->
      // This is much slower (0.5x?) than ArrayList+sort, but ArrayList.sort uses Timsort which is
      // not in-place. What to do? Write our own quicksort? Sounds terrible.
      val itemsInShard = ArrayList<SortKey<K, V>>()
      var shardValuesSize = 0L

      val dumpShard = {
        for (item in itemsInShard) {
          keySerializer.write(item.key, output)
          output.writeVarInt(valueSerializer.size(item.value))
          valueSerializer.write(item.value, output)
          output.checkBufferSpace()
        }

        output.shard()
        itemsInShard.clear()
        shardValuesSize = 0
      }

      var lastHeapCheck = 0L

      val emitter = object : Emitter2<K, V> {
        override fun emit(a: K, b: V) {
          itemsInShard.add(SortKey(a, b))
          shardValuesSize += valueSerializer.size(b)

          // Check the heap every 50mb.
          if (shardValuesSize - lastHeapCheck > 50 * 1024 * 1024) {
            val remains = maxMemory - (runtime.totalMemory() - runtime.freeMemory())
            // If we have less than 256mb of memory, dump
            if (remains < HEAP_DUMP_THRESHOLD) {
              dumpShard()
            }
            lastHeapCheck = shardValuesSize
          }
        }
      }

      longProgress("${context} emitting to shard") { progress ->
        val logged = object : Emitter2<K, V> {
          override fun emit(a: K, b: V) {
            progress.increment()
            emitter.emit(a, b)
          }
        }
        fn(logged)

        dumpShard()
      }
    }

    stream.shards()
  }

  val size = if (shards.isNotEmpty()) shards[shards.size - 1].let { it.start + it.length } else 0
  println("  PMap (mmap) ${keyType} -> ${valueType} in ${shards.size} shards (size ${size})")

  val fileChannel = FileChannel.open(sharded.toPath())
  return Pair(sharded, shards.map { s ->
    EncodedInputStream(fileChannel.map(MapMode.READ_ONLY, s.start, s.length))
  })
}

private fun <K : Comparable<K>, V : Any> mergeSortedShards(
    context: String,
    keyType: TypeToken<K>,
    valueType: TypeToken<out V>,
    unmergedShards: List<EncodedInputStream>,
    keySerializer: Serializer<K>,
    valueSerializer: Serializer<V>,
    handles: AtomicInteger,
): () -> MmapPMap<K, V> {
  val merged =
      File.createTempFile(cleanFilename("mmap-map-merged-${keyType}-${valueType}"), null)
  merged.deleteOnExit()

  val shards = RandomAccessFile(merged, "rw").use {
    val stream = EncodedOutputStream(it.channel)
    stream.use { output ->
      val heap = PriorityQueue<MergeKey<K>>()
      for (shard in unmergedShards) {
        if (shard.hasRemaining()) {
          val key = keySerializer.read(shard)
          val size = shard.readVarInt()
          val value = ByteArray(size)
          shard.read(value)
          heap.add(MergeKey(key, value, shard))
        }
      }

      longProgress("${context} merging shards") { progress ->
        var last: K? = null
        val values = ArrayList<ByteArray>()
        while (heap.isNotEmpty()) {
          val min = heap.poll()
          if (last == null) {
            last = min.key
          } else if (last.compareTo(min.key) != 0) {
            keySerializer.write(last, output)
            output.writeVarInt(values.size)
            for (value in values) {
              output.write(value)
            }
            output.checkBufferSpace()
            progress.incrementBy(values.size)
            values.clear()
            last = min.key
          }

          values.add(min.value)

          val source = min.source
          if (source.hasRemaining()) {
            val key = keySerializer.read(source)
            val size = source.readVarInt()
            val value = ByteArray(size)
            source.read(value)
            heap.add(MergeKey(key, value, min.source))
          }
        }

        if (last != null) {
          keySerializer.write(last, output)
          output.writeVarInt(values.size)
          for (value in values) {
            output.write(value)
          }
          progress.incrementBy(values.size)
          values.clear()
        }
      }
    }

    stream.shards()
  }

  val size = if (shards.isNotEmpty()) shards[shards.size - 1].let { it.start + it.length } else 0
  println("  PMap (mmap) ${keyType} -> ${valueType} size ${size}")

  val postsortChannel = FileChannel.open(merged.toPath())
  val fileReference = FileReference(merged, handles)

  return {
    val opened = shards.map { s ->
      EncodedInputStream(postsortChannel.map(MapMode.READ_ONLY, s.start, s.length))
    }
    MmapPMap(
        opened, keySerializer, valueSerializer, opened.sumOf { it.size().toLong() }, fileReference)
  }
}

private data class MergeKey<K : Comparable<K>>(
    val key: K, val value: ByteArray, val source: EncodedInputStream)
  : Comparable<MergeKey<K>> {

  override fun compareTo(other: MergeKey<K>): Int {
    return key.compareTo(other.key)
  }
}

private data class SortKey<K : Comparable<K>, V>(val key: K, val value: V)
  : Comparable<SortKey<K, V>> {

  override fun compareTo(other: SortKey<K, V>): Int {
    return key.compareTo(other.key)
  }
}
