import type { Owner, PlayerId } from "../shared/types";

export function shouldRenderBuildingRally(input: {
  selected: boolean;
  trainable: boolean;
  owner?: Owner | undefined;
  viewer?: PlayerId | undefined;
}) {
  return input.selected && input.trainable && !!input.viewer
    && input.viewer !== "neutral" && input.owner === input.viewer;
}
