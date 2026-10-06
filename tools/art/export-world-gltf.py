"""Export every ship and authored building as compact material-grouped GLBs.

Run the ship builder with SKETCH_SHIP_MODELS_ONLY=1 and export-building-geometry.ts
first. No runtime geometry is guessed from a sprite or from a unit's cost.
"""
import json
from pathlib import Path
import bpy
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "public/art/world3d"
config = json.loads((ROOT / "assets/naval/ships.json").read_text())


def export(objects, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True,
                              export_yup=True, export_apply=True, export_extras=True,
                              export_cameras=False, export_lights=False)
    print("WORLD_GLTF", path.relative_to(ROOT), path.stat().st_size, flush=True)


for kind, spec in config["ships"].items():
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / f".art-build/ships/{kind}.blend"))
    depsgraph = bpy.context.evaluated_depsgraph_get()
    groups = {"Hull": [], "Gun": []}
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        group = "Gun" if obj.parent and obj.parent.name == "traversing weapon" else "Hull"
        world = obj.matrix_world.copy()
        obj.data = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph), depsgraph=depsgraph)
        obj.modifiers.clear()
        obj.parent = None
        obj.matrix_world = world
        obj.hide_render = False
        obj.hide_set(False)
        groups[group].append(obj)
    components = []
    for name, objects in groups.items():
        if not objects:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
        obj = bpy.context.object
        obj.name = name
        bpy.context.scene.cursor.location = Vector(spec["weaponPivot"] if name == "Gun" else (0, 0, 0))
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
        # World map +y is GPU +z. glTF converts Blender +y to -z, so
        # reflect and bake here (including winding), never use negative instance
        # scales or an inverted camera projection at runtime.
        origin = obj.location.copy()
        reflection = Matrix.Diagonal((1, -1, 1, 1))
        obj.data.transform(reflection @ obj.matrix_world)
        obj.data.flip_normals()
        origin.y *= -1
        obj.data.transform(Matrix.Translation(-origin))
        obj.matrix_world = Matrix.Translation(origin)
        obj["component"] = name.lower()
        components.append(obj)
    export(components, OUTPUT / f"ships/{kind}.glb")


models = json.loads((ROOT / ".art-build/buildings/geometry.json").read_text())
for kind, faces in models.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials = {}
    vertices, polygons, material_ids = [], [], []
    for face in faces:
        color = face["color"]
        if color not in materials:
            m = bpy.data.materials.new("TeamColor" if color == "#ff00ff" else color)
            m.use_nodes = True
            rgb = (.36, .39, .37) if color == "#ff00ff" else tuple((int(color[i:i+2], 16)/255)**2.2 for i in (1, 3, 5))
            shader = m.node_tree.nodes.get("Principled BSDF")
            shader.inputs["Base Color"].default_value = (*rgb, 1)
            shader.inputs["Roughness"].default_value = .82
            shader.inputs["Metallic"].default_value = .25 if color in ("#86948f", "#b3825d", "#d2b779") else 0
            materials[color] = m
        points = face["p"]
        winding = list(range(len(points)))
        if (Vector(points[1])-Vector(points[0])).cross(Vector(points[2])-Vector(points[0])).dot(Vector(face["normal"])) < 0:
            winding.reverse()
        start = len(vertices)
        vertices.extend([[x, -y, z] for x, y, z in points])
        winding.reverse()
        polygons.append([start+i for i in winding])
        material_ids.append(list(materials).index(color))
    mesh = bpy.data.meshes.new(kind)
    mesh.from_pydata(vertices, [], polygons)
    mesh.update()
    obj = bpy.data.objects.new("Building", mesh)
    bpy.context.collection.objects.link(obj)
    for mat in materials.values():
        mesh.materials.append(mat)
    for polygon, material_id in zip(mesh.polygons, material_ids):
        polygon.material_index = material_id
    obj["component"] = "building"
    export([obj], OUTPUT / f"buildings/{kind}.glb")
