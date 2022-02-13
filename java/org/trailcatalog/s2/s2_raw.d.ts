export declare namespace com.google.common.geometry {
  class S1Angle {
    static degrees(n: number): S1Angle;
  }
  
  class S2CellId {
    toToken(): string;
  }

  class S2LatLng {
    static fromDegrees(lat: number, lon: number): S2LatLng;
    static fromRadians(lat: number, lon: number): S2LatLng;
    latRadians(): number;
    lngRadians(): number;
  }

  class S2LatLngRect {
    static fromPoint(point: S2LatLng): S2LatLngRect;
    static fromPointPair(p1: S2LatLng, p2: S2LatLng): S2LatLngRect;
    expandedByDistance(distance: S1Angle): S2LatLngRect;
  }
}

export declare namespace java.util {
  class ArrayList<V> {
    getAtIndex(i: number): V;
    size(): number;
  }
}

export declare namespace org.trailcatalog.s2 {
  class SimpleS2 {
    static cover(viewport: com.google.common.geometry.S2LatLngRect):
        java.util.ArrayList<com.google.common.geometry.S2CellId>;
  }
}
