import { createMapPresentation, type MapPresentationMark } from '../shared/presentation';
import type { GameSnapshot } from '../shared/types';

/** One minimap's derived marks. A publication token may be supplied only by an
 * owner that keeps that view unchanged until the next publication. Merely having
 * the same tick, array lengths or arbitrary snapshot object is not that contract.
 * Without a token, mutable/unknown providers keep rebuilding from current truth.
 * Painting (relations, cabin crew, items, wind and the camera) stays live. */
export class MinimapPresentationCache {
  private snapshot: GameSnapshot | undefined;
  private publication: object | undefined;
  private marks: MapPresentationMark[] | undefined;

  read(snapshot: GameSnapshot, publication?: object): MapPresentationMark[] {
    if (publication && this.snapshot === snapshot && this.publication === publication && this.marks) return this.marks;
    const marks = createMapPresentation(snapshot);
    if (publication) {
      this.snapshot = snapshot;
      this.publication = publication;
      this.marks = marks;
    } else this.reset();
    return marks;
  }

  reset(): void {
    this.snapshot = undefined;
    this.publication = undefined;
    this.marks = undefined;
  }
}
