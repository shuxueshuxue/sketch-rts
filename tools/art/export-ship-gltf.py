"""Export the existing editable warship to a compact, two-component GLB.

Run: blender --background --python tools/art/export-ship-gltf.py
Generate .art-build/ships/warship.blend with build-ships.py first.
Hull and Gun retain the simulation's authoring units; glTF converts Z-up to Y-up.
"""
import json
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
bpy.ops.wm.open_mainfile(filepath=str(ROOT / ".art-build/ships/warship.blend"))
spec = json.loads((ROOT / "assets/naval/ships.json").read_text())["ships"]["warship"]
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
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    bpy.context.scene.cursor.location = Vector(spec["weaponPivot"] if name == "Gun" else (0, 0, 0))
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    obj["component"] = name.lower()
    components.append(obj)

bpy.ops.object.select_all(action="DESELECT")
for obj in components:
    obj.select_set(True)
output = ROOT / "public/art/ships3d/warship.glb"
output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB", use_selection=True,
                          export_yup=True, export_apply=True, export_extras=True,
                          export_cameras=False, export_lights=False)
print("SHIP_GLTF", output, output.stat().st_size)
