"""Procedural cloth for the ship builder, with no Blender or texture dependency.

Both builders accept world-space corners and the builder's ``mesh`` / ``spar``
callbacks. ``mesh(name, vertices, faces, material, layer)`` must return a Blender
mesh object; ``spar(name, start, end, radius, material, layer)`` adds a thin line.
``materials`` is a nonempty sequence of subtly different cloth materials whose
names retain the ``unbleached sail`` prefix used by the game's deck reveal.
Each builder returns its cloth object and appends all generated pieces to layer.
Positive depth gives the cloth a belly toward world +X, with taut boundary ropes.
"""

import math


def _point(corners, weights, belly):
    point = [sum(corner[axis] * weight for corner, weight in zip(corners, weights))
             for axis in range(3)]
    point[0] += belly
    return tuple(point)


def _cloth(name, vertices, faces, columns, materials, mesh, layer):
    if not materials:
        raise ValueError("Sails require at least one cloth material")
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
                    layer, panels=8, rows=6):
    """Build a cambered four-corner sail with sewn vertical cloth panels.

    Corners are lower-left, lower-right, upper-right, upper-left. Panel seams
    follow the same surface as the cloth, so they remain attached to its belly.
    """
    if len(corners) != 4 or panels < 2 or rows < 2:
        raise ValueError("Quad sails need four corners and at least two panels/rows")

    def surface(u, v):
        weights = ((1 - u) * (1 - v), u * (1 - v), u * v, (1 - u) * v)
        belly = 0 if u in (0, 1) or v in (0, 1) else depth * math.sin(math.pi * u) * math.sin(math.pi * v)
        return _point(corners, weights, belly)

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
                        spar, layer, panels=6):
    """Build a triangular sail with radial panels meeting at the third corner.

    All vertices use barycentric interpolation. The belly vanishes on every
    boundary, keeping all three corners and their bolt ropes under tension.
    """
    if len(corners) != 3 or panels < 2:
        raise ValueError("Triangle sails need three corners and at least two panels")

    def surface(u, v):
        a, b, c = (1 - u) * (1 - v), u * (1 - v), v
        return _point(corners, (a, b, c), depth * 27 * a * b * c)

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
