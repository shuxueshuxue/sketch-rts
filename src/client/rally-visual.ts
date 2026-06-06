type Point = { x: number; y: number };

export function shouldRenderBuildingRally(input: {
  selected: boolean;
  trainable: boolean;
  buildingPoint: Point;
  rallyPoint: Point;
  nearScreen: (point: Point, pad: number) => boolean;
}) {
  if (!input.selected || !input.trainable) return false;
  return input.nearScreen(input.buildingPoint, 80) || input.nearScreen(input.rallyPoint, 80);
}
