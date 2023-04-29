package org.trailcatalog.importers.elevation.contour

import com.google.common.cache.CacheBuilder
import com.google.common.cache.CacheLoader
import com.google.common.cache.LoadingCache
import com.google.common.collect.Lists
import com.google.common.geometry.S1Angle
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import com.google.protobuf.CodedInputStream
import com.mapbox.proto.vectortiles.Tile
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.trailcatalog.common.IORuntimeException
import org.trailcatalog.importers.elevation.getCopernicus30mUrl
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.file.Path
import java.util.concurrent.Executors
import kotlin.io.path.exists
import kotlin.math.asin
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.pow
import kotlin.math.tanh

fun main(args: Array<String>) {
  val pool = MoreExecutors.listeningDecorator(Executors.newFixedThreadPool(6))

  val source = Path.of(args[0])
  val dest = Path.of(args[1])

  val zoom = args[2].toInt()
  val worldSize = 2.0.pow(zoom).toInt()
  val tolerance =
      S1Angle.degrees(
          if (zoom < 14) {
            12.5 * 360.0 / worldSize / EXTENT_TILE
          } else {
            0.003 / EXTENT_TILE
          }
      )

  val cache =
      CacheBuilder
          .newBuilder()
          .maximumSize(30)
          .build(object : CacheLoader<Pair<Int, Int>, Pair<List<Contour>, List<Contour>>>() {
            override fun load(p0: Pair<Int, Int>): Pair<List<Contour>, List<Contour>> {
              val (lat, lng) = p0
              val mvt = source.resolve(getCopernicusMvt(lat, lng))
              val contoursFt = ArrayList<Contour>()
              val contoursM = ArrayList<Contour>()
              if (mvt.exists()) {
                loadContourMvt(
                    contoursFt,
                    contoursM,
                    mvt,
                    S2LatLngRect.fromPointPair(
                        S2LatLng.fromDegrees(lat.toDouble(), lng.toDouble()),
                        S2LatLng.fromDegrees(lat.toDouble() + 1, lng.toDouble() + 1)))
              }
              return Pair(
                  contoursFt.map { Contour(it.height, simplifyContour(it.points, tolerance)) },
                  contoursM.map { Contour(it.height, simplifyContour(it.points, tolerance)) })
            }
          })

  val low = if (args.size >= 7) Pair(args[3].toInt(), args[4].toInt()) else Pair(0, 0)
  val high =
      if (args.size >= 7) Pair(args[5].toInt(), args[6].toInt()) else Pair(worldSize, worldSize)
  val tasks = ArrayList<ListenableFuture<*>>()
  for (y in low.second until high.second) {
    for (x in low.first until high.first) {
      tasks.add(pool.submit { cropTile(x, y, zoom, dest, cache) })
    }
    tasks.add(pool.submit {
      println(y)
    })
  }

  Futures.allAsList(tasks).get()
  pool.shutdown()
}

private fun getCopernicusMvt(lat: Int, lng: Int): String {
  return getCopernicus30mUrl(lat, lng).toHttpUrl().pathSegments.last() + ".mvt"
}

private fun cropTile(
    x: Int,
    y: Int,
    z: Int,
    dest: Path,
    cache: LoadingCache<Pair<Int, Int>, Pair<List<Contour>, List<Contour>>>) {
  val worldSize = 2.0.pow(z)
  val latLow = asin(tanh((0.5 - (y + 1) / worldSize) * 2 * Math.PI)) / Math.PI * 180
  val lngLow = x.toDouble() / worldSize * 360 - 180
  val latHigh = asin(tanh((0.5 - y / worldSize) * 2 * Math.PI)) / Math.PI * 180
  val lngHigh = (x.toDouble() + 1) / worldSize * 360 - 180

  val contoursFt = ArrayList<Contour>()
  val contoursM = ArrayList<Contour>()
  for (lat in floor(latLow).toInt() until ceil(latHigh).toInt()) {
    for (lng in floor(lngLow).toInt() until ceil(lngHigh).toInt()) {
      val result = cache[Pair(lat, lng)]
      contoursFt.addAll(result.first)
      contoursM.addAll(result.second)
    }
  }

  val bound =
      S2LatLngRect.fromPointPair(
          S2LatLng.fromDegrees(latLow, lngLow),
          S2LatLng.fromDegrees(latHigh, lngHigh))
  val cropFt = crop(contoursFt, bound)
  val cropM = crop(contoursM, bound)

  if (cropFt.isEmpty() || cropM.isEmpty()) {
    return
  }

  val tile = contoursToTile(cropFt, cropM, bound, EXTENT_TILE, z)
  val output = dest.resolve("${z}/${x}/${y}.pbf")
  output.parent.toFile().mkdirs()

  FileOutputStream(output.toFile()).use {
    tile.writeTo(it)
  }
}

private fun loadContourMvt(
    contoursFt: MutableList<Contour>,
    contoursM: MutableList<Contour>,
    path: Path,
    bound: S2LatLngRect) {
  val tile = FileInputStream(path.toFile()).use {
    Tile.parseFrom(it)
  }

  val low = project(bound.lo())
  val high = project(bound.hi())

  for (layer in tile.layersList) {
    val contours =
        when (layer.name) {
          "contour" -> contoursM
          "contour_ft" -> contoursFt
          else -> throw IORuntimeException("Unknown layer name ${layer.name}")
        }

    for (feature in layer.featuresList) {
      if (feature.type != Tile.GeomType.LINESTRING) {
        throw IORuntimeException("Cannot read anything but linestrings")
      }

      var height: Int? = null
      for (i in 0 until feature.tagsCount step 2) {
        if (layer.getKeys(feature.getTags(i)) == "height") {
          height = layer.getValues(feature.getTags(i + 1)).intValue.toInt()
        }
      }

      if (height == null) {
        throw IORuntimeException("Unknown height")
      }

      var i = 0
      var x = 0
      var y = 0
      var building: ArrayList<S2LatLng>? = null
      while (i < feature.geometryCount) {
        val tag = feature.getGeometry(i)
        i += 1

        val command = tag.and(7)
        val count = tag.ushr(3)
        if (command == 1) { // move to
          var j = 0
          while (j < count) {
            building = ArrayList()
            contours.add(Contour(height, building))

            x += CodedInputStream.decodeZigZag32(feature.getGeometry(i + 0))
            y += CodedInputStream.decodeZigZag32(feature.getGeometry(i + 1))
            building.add(unproject(x, y, low, high, layer.extent))
            j += 1
            i += 2
          }
        } else if (command == 2) {
          var j = 0
          while (j < count) {
            x += CodedInputStream.decodeZigZag32(feature.getGeometry(i + 0))
            y += CodedInputStream.decodeZigZag32(feature.getGeometry(i + 1))
            building!!.add(unproject(x, y, low, high, layer.extent))
            j += 1
            i += 2
          }
        } else {
          throw IORuntimeException("Unknown command ${command}")
        }
      }
    }
  }
}

private fun crop(contours: List<Contour>, view: S2LatLngRect): List<Contour> {
  val out = ArrayList<Contour>()
  for (contour in contours) {
    crop(contour, view, out)
  }
  return out
}

private fun crop(contour: Contour, view: S2LatLngRect, out: MutableList<Contour>) {
  var i = 0
  val lls = contour.points

  while (i < lls.size) {
    while (i < lls.size && !view.contains(lls[i])) {
      i += 1
    }

    if (i == lls.size) {
      break
    }

    var j = i + 1
    while (j < lls.size && view.contains(lls[j])) {
      j += 1
    }

    val first = Math.max(0, i - 1)
    val last = j
    val count = last - first
    val span = Lists.newArrayListWithExpectedSize<S2LatLng>(count)
    for (p in first until last) {
      span.add(lls[p])
    }
    out.add(Contour(contour.height, span))

    i = j
  }
}

private fun unproject(
    x: Int, y: Int, low: Pair<Double, Double>, high: Pair<Double, Double>, extent: Int): S2LatLng {
  val dx = high.first - low.first
  val dy = high.second - low.second

  val xw = low.first + dx * x / extent
  val yw = high.second - dy * y / extent
  return S2LatLng.fromRadians(asin(tanh(yw * Math.PI)), Math.PI * xw)
}
