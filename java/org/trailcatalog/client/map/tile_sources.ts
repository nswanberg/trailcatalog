import { BitmapTileset, VectorTileset } from '../common/types';

export const CONTOURS: VectorTileset = {
  extraZoom: 0,
  minZoom: 10,
  maxZoom: 10,
  tileUrl: 'https://tiles.trailcatalog.org/contours/${id.zoom}/${id.x}/${id.y}_ft.cbf',
  type: 'vector',
} as const;

export const MAPTILER_TOPO: BitmapTileset = {
  extraZoom: -1, // we're using the 512x512px tiles
  minZoom: 2,
  maxZoom: 12,
  tileUrl: 'https://api.maptiler.com/maps/topo/${id.zoom}/${id.x}/${id.y}.png?' +
      'key=wWxlJy7a8SEPXS7AZ42l',
  type: 'bitmap',
} as const;

export const THUNDERFOREST_TOPO: BitmapTileset = {
  extraZoom: 0,
  minZoom: 2, // TODO: who cares
  maxZoom: 22,
  tileUrl: 'https://tile.thunderforest.com/landscape/${id.zoom}/${id.x}/${id.y}.png' +
      'apikey=d72e980f5f1849fbb9fb3a113a119a6f',
  type: 'bitmap',
} as const;
