"""Procedural cloth for the ship builder, with no Blender or texture dependency.

Both builders accept world-space corners and the builder's ``mesh`` / ``spar``
callbacks. ``mesh(name, vertices, faces, material, layer)`` must return a Blender
mesh object; ``spar(name, start, end, radius, material, layer)`` adds a thin line.
``materials`` is a nonempty sequence of subtly different cloth materials whose
names retain the ``unbleached sail`` prefix used by the game's deck reveal.
Each builder returns its cloth object and appends all generated pieces to layer.
Positive depth gives the cloth a belly normal to its corner-defined surface,
with taut boundary ropes. Optional ``billow_direction`` chooses which side of
that surface receives the belly; it is a static pose hint, not a wind simulation.
"""

import math


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def _dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def _vector(value, label):
    try:
        result = tuple(float(component) for component in value)
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError(label + " must contain three finite coordinates") from error
    if len(result) != 3 or not all(math.isfinite(component) for component in result):
        raise ValueError(label + " must contain three finite coordinates")
    return result


def _pose(corners, corner_count, depth, billow_direction):
    """Return validated corners and a rotation-equivariant unit belly normal."""
    if len(corners) != corner_count:
        raise ValueError(f"Sail requires {corner_count} corners")
    corners = tuple(_vector(corner, "Sail corner") for corner in corners)
    try:
        depth = float(depth)
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError("Sail depth must be finite and nonnegative") from error
    if not math.isfinite(depth) or depth < 0:
        raise ValueError("Sail depth must be finite and nonnegative")

    # Work at unit scale to compare area without depending on the authored
    # ship's size. Centering also makes normal selection translation invariant.
    scale = max(math.dist(corner, corners[0]) for corner in corners)
    if not math.isfinite(scale) or scale == 0:
        raise ValueError("Sail corners must span a finite nonzero area")
    points = [tuple((a - b) / scale for a, b in zip(corner, corners[0])) for corner in corners]
    area = [0.0, 0.0, 0.0]
    for i, point in enumerate(points):
        cross = _cross(point, points[(i + 1) % corner_count])
        area = [a + b for a, b in zip(area, cross)]
    magnitude = math.hypot(*area)
    if magnitude <= 1e-10:
        raise ValueError("Sail corners must span a nondegenerate surface")
    normal = tuple(component / magnitude for component in area)
    # A convex projection gives every generated face a consistent orientation,
    # including mildly twisted quads. Reject crossed or collapsed corner order.
    for i, point in enumerate(points):
        following, last = points[(i + 1) % corner_count], points[(i + 2) % corner_count]
        first_edge = tuple(b - a for a, b in zip(point, following))
        next_edge = tuple(b - a for a, b in zip(following, last))
        if _dot(_cross(first_edge, next_edge), normal) <= 1e-10:
            raise ValueError("Sail corners must form a convex, nondegenerate perimeter")

    if billow_direction is not None:
        direction = _vector(billow_direction, "Billow direction")
        length = math.hypot(*direction)
        if not math.isfinite(length) or length == 0:
            raise ValueError("Billow direction must be a finite nonzero vector")
        alignment = _dot(normal, tuple(component / length for component in direction))
        if abs(alignment) <= 1e-8:
            raise ValueError("Billow direction must have a component normal to the sail")
        if alignment < 0:
            normal = tuple(-component for component in normal)
    return corners, depth, normal


def _subdivisions(value, label):
    if not isinstance(value, int) or isinstance(value, bool) or value < 2:
        raise ValueError(label + " must be an integer of at least two")


def _point(corners, weights, normal, belly):
    point = [sum(corner[axis] * weight for corner, weight in zip(corners, weights))
             for axis in range(3)]
    return tuple(position + direction * belly for position, direction in zip(point, normal))


def _cloth(name, vertices, faces, columns, materials, mesh, layer):
    if not materials:
        raise ValueError("Sails require at least one cloth material")
    if not all(math.isfinite(component) for vertex in vertices for component in vertex):
        raise ValueError("Sail coordinates and depth exceed the finite geometry range")
    obj = mesh(name, vertices, faces, materials[0], layer)
    for material in materials[1:]:
        obj.data.materials.append(material)
    # Mostly the base fabric, with occasional warm or sun-faded sewn panels.
    # Avoid a regular alternating pattern, which reads as a striped sail.
    variation = (0, 0, 1, 0, 2, 0, 0, 1)
    for polygon, column in zip(obj.data.polygons, columns):
        polygon.material_index = variation[column % len(variation)] % len(materials)
        polygon.use_smooth = True
    return obj


def _line(name, points, radius, material, spar, layer):
    for start, end in zip(points, points[1:]):
        if sum((a - b) ** 2 for a, b in zip(start, end)) > 1e-10:
            spar(name, start, end, radius, material, layer)


def build_quad_sail(name, corners, depth, materials, rope_material, mesh, spar,
                    layer, panels=8, rows=6, *, billow_direction=None):
    """Build a cambered four-corner sail with sewn vertical cloth panels.

    Corners are lower-left, lower-right, upper-right, upper-left. Panel seams
    follow the same surface as the cloth, so they remain attached to its belly.
    ``billow_direction`` selects the side of the area-weighted corner normal;
    without it, the corner winding selects the side. A tangent hint is rejected.
    """
    _subdivisions(panels, "Sail panels")
    _subdivisions(rows, "Sail rows")
    corners, depth, normal = _pose(corners, 4, depth, billow_direction)

    def surface(u, v):
        weights = ((1 - u) * (1 - v), u * (1 - v), u * v, (1 - u) * v)
        belly = 0 if u in (0, 1) or v in (0, 1) else depth * math.sin(math.pi * u) * math.sin(math.pi * v)
        return _point(corners, weights, normal, belly)

    vertices = [surface(col / panels, row / rows)
                for row in range(rows + 1) for col in range(panels + 1)]
    faces, columns = [], []
    for row in range(rows):
        for col in range(panels):
            first = row * (panels + 1) + col
            faces.append((first, first + 1, first + panels + 2, first + panels + 1))
            columns.append(col)
    obj = _cloth(name, vertices, faces, columns, materials, mesh, layer)

    for v in (0, 1):
        _line(name + " bolt rope", [surface(col / panels, v) for col in range(panels + 1)],
              .21, rope_material, spar, layer)
    for u in (0, 1):
        _line(name + " bolt rope", [surface(u, row / rows) for row in range(rows + 1)],
              .21, rope_material, spar, layer)
    for col in range(1, panels):
        _line(name + " sewn panel", [surface(col / panels, row / rows) for row in range(rows + 1)],
              .09, materials[-1], spar, layer)
    return obj


def build_triangle_sail(name, corners, depth, materials, rope_material, mesh,
                        spar, layer, panels=6, *, billow_direction=None):
    """Build a triangular sail with radial panels meeting at the third corner.

    All vertices use barycentric interpolation. The belly vanishes on every
    boundary, keeping all three corners and their bolt ropes under tension.
    ``billow_direction`` selects a side of the corner-plane normal. Without a
    hint the corner winding selects the side; a tangent direction is rejected.
    """
    _subdivisions(panels, "Sail panels")
    corners, depth, normal = _pose(corners, 3, depth, billow_direction)

    def surface(u, v):
        a, b, c = (1 - u) * (1 - v), u * (1 - v), v
        return _point(corners, (a, b, c), normal, depth * (27 * a * b * c))

    # Equal barycentric rings keep the seams radial. Use one apex vertex, so
    # the last ring ends in real triangles rather than collapsed quads.
    vertices = [surface(col / panels, row / panels)
                for row in range(panels) for col in range(panels + 1)]
    apex = len(vertices)
    vertices.append(tuple(corners[2]))
    faces, columns = [], []
    for row in range(panels):
        for col in range(panels):
            first = row * (panels + 1) + col
            if row == panels - 1:
                faces.append((first, first + 1, apex))
            else:
                faces.append((first, first + 1, first + panels + 2, first + panels + 1))
            columns.append(col)
    obj = _cloth(name, vertices, faces, columns, materials, mesh, layer)

    _line(name + " bolt rope", [surface(col / panels, 0) for col in range(panels + 1)],
          .20, rope_material, spar, layer)
    for u in (0, 1):
        _line(name + " bolt rope", [surface(u, row / panels) for row in range(panels + 1)],
              .20, rope_material, spar, layer)
    for col in range(1, panels):
        _line(name + " radial seam", [surface(col / panels, row / panels) for row in range(panels + 1)],
              .085, materials[-1], spar, layer)
    return obj
