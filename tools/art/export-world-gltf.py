"""Export every ship and authored building as compact material-grouped GLBs.

Run build-ships.py and export-building-geometry.ts first. SKETCH_MODEL_ONLY can
select comma-separated ship or building names. No runtime geometry is guessed
from a sprite or from a unit's cost.

Hull extras.shipRig contains the visual rig contract in glTF Y-up coordinates:
frames rotate rigidParts and sails around an explicit pivot/axis; ropes refer
to ship-fixed, frame-fixed, or sail-morph anchors. A sail anchor stores absolute
flat-basis point plus positive/negative/furl displacement vectors, exactly like
the native mesh targets. Weights are max(billow,0)*set, max(-billow,0)*set, 1-set.
Main-frame angleScale is -1 because [ship X,Z,Y] reverses handedness. Materials
for dynamic ropes are included even when no exported mesh references them.
"""
import json
import math
import os
import struct
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
                              export_yup=True, export_apply=False, export_extras=True,
                              export_cameras=False, export_lights=False)
    print("WORLD_GLTF", path.relative_to(ROOT), path.stat().st_size, flush=True)


def gpu(point):
    """The authored reflection and glTF Y-up conversion map +mapY to +GPU Z."""
    return [float(point[0]), float(point[2]), float(point[1])]


def surface_anchor(anchor, surfaces):
    if "sailId" not in anchor:
        return {**anchor, "point": gpu(anchor["point"])}
    surface = surfaces[anchor["sailId"]]
    u, v = anchor["uv"]
    if surface["shape"] == "quad":
        weights = ((1-u)*(1-v), u*(1-v), u*v, (1-u)*v)
        kernel = 0 if u in (0, 1) or v in (0, 1) else math.sin(math.pi*u)*math.sin(math.pi*v)
    else:
        weights = ((1-u)*(1-v), u*(1-v), v)
        kernel = 27*weights[0]*weights[1]*weights[2]
    blend = lambda corners: [sum(p[axis]*weight for p, weight in zip(corners, weights)) for axis in range(3)]
    base, furled = blend(surface["corners"]), blend(surface["furlCorners"])
    return {"sailId": anchor["sailId"], "point": gpu(base), "morphDeltas": {
        "positive": gpu([value*surface["maxDepth"]*kernel for value in surface["billowAxis"]]),
        "negative": gpu([-value*surface["negativeDepth"]*kernel for value in surface["billowAxis"]]),
        "furl": gpu([b-a for a, b in zip(base, furled)]),
    }}


def rig_manifest(scene):
    rig = json.loads(scene.objects["ship origin"]["shipRig"])
    surfaces = {json.loads(obj["sailSurface"])["id"]: json.loads(obj["sailSurface"])
                for obj in scene.objects if obj.type == "MESH" and "sailSurface" in obj}
    rig["space"] = "glTF-y-up"
    for frame in rig["frames"]:
        frame["pivot"], frame["axis"] = gpu(frame["pivot"]), gpu(frame["axis"])
        frame["angleScale"] *= -1
        frame["angleOffset"] *= -1
        frame["angleLimits"] = [-frame["angleLimits"][1], -frame["angleLimits"][0]]
    for sail in rig["sails"]:
        source = surfaces[sail["id"]]
        sail.update({"shape": source["shape"], "corners": [gpu(p) for p in source["corners"]],
                     "furlCorners": [gpu(p) for p in source["furlCorners"]],
                     "billowAxis": gpu(source["billowAxis"]), "maxDepth": source["maxDepth"],
                     "negativeDepth": source["negativeDepth"], "morphTargets": source["morphNames"]})
    rig["ropes"], rig["materials"] = [], {}
    for obj in scene.objects:
        if obj.type != "MESH" or not ("sailRope" in obj or "rigLine" in obj):
            continue
        if "sailRope" in obj:
            source = json.loads(obj["sailRope"])
            entry = {"id": obj.name, "radius": source["radius"],
                     "a": {"sailId": source["sailId"], "uv": source["uvA"]},
                     "b": {"sailId": source["sailId"], "uv": source["uvB"]}}
        else:
            entry = json.loads(obj["rigLine"])
        material = obj.data.materials[0]
        shader = material.node_tree.nodes.get("Principled BSDF")
        rig["materials"][material.name] = {"color": list(shader.inputs["Base Color"].default_value[:3]),
                                            "roughness": shader.inputs["Roughness"].default_value,
                                            "metalness": shader.inputs["Metallic"].default_value}
        rig["ropes"].append({**entry, "material": material.name,
                              "a": surface_anchor(entry["a"], surfaces), "b": surface_anchor(entry["b"], surfaces)})
    return rig


def embed_rig(path, rig):
    """Write structured glTF extras without Blender IDProperty nesting limits."""
    raw = path.read_bytes()
    json_size = struct.unpack_from("<I", raw, 12)[0]
    document = json.loads(raw[20:20+json_size])
    hull = next(node for node in document["nodes"] if node.get("name") == "Hull")
    hull.setdefault("extras", {})["shipRig"] = rig
    encoded = json.dumps(document, separators=(",", ":"), allow_nan=False).encode()
    encoded += b" " * ((-len(encoded)) % 4)
    tail = raw[20+json_size:]
    path.write_bytes(struct.pack("<III", 0x46546c67, 2, 20+len(encoded)+len(tail)) +
                     struct.pack("<I4s", len(encoded), b"JSON") + encoded + tail)


for kind, spec in config["ships"].items():
    if os.environ.get('SKETCH_MODEL_ONLY') and kind not in os.environ['SKETCH_MODEL_ONLY'].split(','):
        continue
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / f".art-build/ships/{kind}.blend"))
    rig = rig_manifest(bpy.context.scene)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    groups = {"Hull": [], "Gun": []}
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        if "sailRope" in obj or "rigLine" in obj:
            continue
        group = "OwnerFlag" if obj.name == "OwnerFlag" else obj.get("rigPart") or ("Gun" if obj.parent and obj.parent.name == "traversing weapon" else "Hull")
        world = obj.matrix_world.copy()
        if "sailSurface" not in obj:
            obj.data = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph), depsgraph=depsgraph)
        obj.modifiers.clear()
        obj.parent = None
        obj.matrix_world = world
        obj.hide_render = False
        obj.hide_set(False)
        groups.setdefault(group, []).append(obj)
    components = []
    for name, objects in groups.items():
        if not objects:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        if len(objects) > 1:
            bpy.ops.object.join()
        obj = bpy.context.object
        obj.name = name
        bpy.context.scene.cursor.location = Vector(spec["weaponPivot"] if name == "Gun" else (0, 0, 0))
        if not obj.data.shape_keys:
            bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
        # World map +y is GPU +z. glTF converts Blender +y to -z, so
        # reflect and bake here (including winding), never use negative instance
        # scales or an inverted camera projection at runtime.
        origin = obj.location.copy()
        reflection = Matrix.Diagonal((1, -1, 1, 1))
        obj.data.transform(reflection @ obj.matrix_world, shape_keys=True)
        obj.data.flip_normals()
        origin.y *= -1
        obj.data.transform(Matrix.Translation(-origin), shape_keys=True)
        obj.matrix_world = Matrix.Translation(origin)
        obj["component"] = name.lower()
        for internal in ("sailSurface", "sailRope", "rigLine", "rigPart"):
            if internal in obj:
                del obj[internal]
        components.append(obj)
    path = OUTPUT / f"ships/{kind}.glb"
    export(components, path)
    embed_rig(path, rig)


models = json.loads((ROOT / ".art-build/buildings/geometry.json").read_text())
for kind, faces in models.items():
    if os.environ.get('SKETCH_MODEL_ONLY') and kind not in os.environ['SKETCH_MODEL_ONLY'].split(','):
        continue
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
