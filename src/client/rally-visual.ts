export function shouldRenderBuildingRally(input: {
  selected: boolean;
  trainable: boolean;
}) {
  if (!input.selected || !input.trainable) return false;
  return true;
}
