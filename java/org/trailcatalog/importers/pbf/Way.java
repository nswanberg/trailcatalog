package org.trailcatalog.importers.pbf;

import java.util.List;

public record Way(long id, int type, String name, List<LatLngE7> points) {}
