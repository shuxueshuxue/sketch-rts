#!/usr/bin/env python3
"""Build editable Blender ships, geometry and 32-direction layered atlases.

Run with Python + Pillow; set BLENDER_BIN or pass --blender. Blender 4+ only
performs offline work. The game consumes the exported PNGs and geometry JSON.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "assets/naval/ships.json"
BUILD = ROOT / ".art-build/ships"
OUTPUT = ROOT / "public/art/ships"


def outline(length, beam, margin=0):
    a, b = length / 2 - margin, beam / 2 - margin
    return [[-a, -b * .55], [-a * .8, -b], [a * .55, -b],
            [a, 0], [a * .55, b], [-a * .8, b], [-a, b * .55]]


def build_in_blender():
    import bpy
    from mathutils import Vector
    config = json.loads(SOURCE.read_text())
    settings = config["camera"]
    BUILD.mkdir(parents=True, exist_ok=True)
    metadata = {"sourceSha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                "camera": settings, "ships": {}}

    def material(name, color, roughness=.85, metallic=0):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        p = m.node_tree.nodes.get("Principled BSDF")
        p.inputs["Base Color"].default_value = (*color, 1)
        p.inputs["Roughness"].default_value = roughness
        p.inputs["Metallic"].default_value = metallic
        return m

    for kind, spec in config["ships"].items():
        bpy.ops.wm.read_factory_settings(use_empty=True)
        base, upper = [], []
        wood = material("weathered oak", (.20, .105, .055))
        plank = material("deck oak", (.36, .24, .13))
        edge = material("cut oak", (.28, .17, .09))
        iron = material("forged iron", (.095, .12, .13), .55, .55)
        canvas = material("unbleached sail", (.50, .44, .32))
        brass = material("aged brass", (.32, .23, .105), .6, .45)

        def mesh(name, vertices, faces, mat, layer):
            data = bpy.data.meshes.new(name)
            data.from_pydata(vertices, [], faces)
            data.update()
            obj = bpy.data.objects.new(name, data)
            bpy.context.collection.objects.link(obj)
            obj.data.materials.append(mat)
            layer.append(obj)
            return obj

        def box(name, at, size, mat, layer):
            bpy.ops.mesh.primitive_cube_add(size=1, location=at)
            obj = bpy.context.object
            obj.name = name
            obj.scale = size
            obj.data.materials.append(mat)
            layer.append(obj)
            bevel = obj.modifiers.new("soft worn edges", "BEVEL")
            bevel.width = .6
            bevel.segments = 1
            return obj

        def cylinder(name, at, radius, height, mat, layer, rotation=None):
            bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=radius, depth=height, location=at)
            obj = bpy.context.object
            obj.name = name
            if rotation:
                obj.rotation_euler = rotation
            obj.data.materials.append(mat)
            layer.append(obj)
            return obj

        length, beam, z = spec["length"], spec["beam"], spec["deckHeight"]
        hull, deck = outline(length, beam), outline(length, beam, 5)
        n = len(hull)
        bottom = [[x * .84, y * .7, 0] for x, y in hull]
        top = [[x, y, z] for x, y in hull]
        mesh("hull", bottom + top,
             [tuple(range(n - 1, -1, -1)), *[(i, (i+1) % n, (i+1) % n+n, i+n) for i in range(n)]], wood, base)
        mesh("walking deck", [[x, y, z] for x, y in deck], [tuple(range(n))], plank, base)
        for x in range(int(-length*.45), int(length*.45), 5):
            cuts=[]
            for i,(xx,yy) in enumerate(deck):
                nx,ny=deck[(i+1)%len(deck)]
                if min(xx,nx)<=x<=max(xx,nx) and nx!=xx:
                    cuts.append(yy+(ny-yy)*(x-xx)/(nx-xx))
            if len(cuts)>=2:
                low,high=min(cuts),max(cuts)
                box("plank seam",(x,(low+high)/2,z+.06),(.28,max(0,high-low-1),.12),edge,base)
        for i, (x, y) in enumerate(hull):
            xx, yy = hull[(i+1) % n]
            mid = ((x+xx)/2, (y+yy)/2)
            rail = box("bulwark", (*mid, z+2), (math.hypot(xx-x, yy-y), 2.1, 4), edge, upper)
            rail.rotation_euler.z = math.atan2(yy-y, xx-x)
            for t in (.15, .85):
                box("rail post", (x+(xx-x)*t, y+(yy-y)*t, z+3), (2.3, 2.3, 6), iron, upper)

        for obstacle in spec["obstacles"]:
            x, y, r = obstacle["x"], obstacle["y"], obstacle["radius"]
            if obstacle["type"] == "mast":
                h = 48 if kind == "cutter" else 64
                cylinder("mast footing", (x, y, z+1.4), r, 2.8, iron, upper)
                cylinder("mast", (x, y, z+h/2), 1.7, h, edge, upper)
                cylinder("yard", (x, y, z+h*.8), 1, beam*.83, edge, upper, (math.pi/2, 0, 0))
                # A curved sail gives a readable silhouette from every direction.
                vertices, faces = [], []
                for row in range(5):
                    for col in range(7):
                        yy = (col/6-.5)*beam*.77
                        bulge = math.sin(col/6*math.pi)*math.sin(row/4*math.pi)*6
                        vertices.append((x+bulge, y+yy, z+h*(.37+row/4*.40)))
                for row in range(4):
                    for col in range(6):
                        i = row*7+col
                        faces.append((i, i+1, i+8, i+7))
                sail = mesh("canvas sail", vertices, faces, canvas, upper)
                solid = sail.modifiers.new("sail thickness", "SOLIDIFY")
                solid.thickness = .18
            elif obstacle["type"] == "gun":
                cylinder("gun carriage", (x, y, z+2), r, 4, edge, upper)
                cylinder("cannon", (x+8, y, z+7), 4.2, 35, iron, upper, (0, math.pi/2, 0))
                cylinder("muzzle", (x+26, y, z+7), 4.4, 1.6, brass, upper, (0, math.pi/2, 0))
            elif obstacle["type"] == "mortar":
                cylinder("mortar bed", (x, y, z+2), r, 4, iron, upper)
                cylinder("bombard barrel", (x+3, y, z+12), 9, 24, iron, upper, (0, .45, 0))
                cylinder("bombard lip", (x+8, y, z+24), 9.5, 2.5, brass, upper, (0, .45, 0))
            else:
                box("fuel housing", (x, y, z+7), (r*1.6, r*1.3, 14), iron, upper)
                for yy in (-r*.36, r*.36):
                    cylinder("fuel tank", (x, yy, z+9), 6, 28, brass, upper, (0, math.pi/2, 0))
                cylinder("flame nozzle", (x+26, 0, z+6), 3, 32, iron, upper, (0, math.pi/2, 0))
        box("stern rudder", (-length/2-2, 0, 3), (5, 2, 11), iron, base)
        fittings = base + upper
        rig = bpy.data.objects.new("ship origin", None)
        bpy.context.collection.objects.link(rig)
        for obj in fittings:
            obj.parent = rig

        scene = bpy.context.scene
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = 12
        scene.cycles.use_denoising = False
        scene.render.threads_mode = "FIXED"
        scene.render.threads = 4
        scene.render.resolution_x = scene.render.resolution_y = settings["frameSize"]
        scene.render.resolution_percentage = 100
        scene.render.film_transparent = True
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"
        scene.view_settings.view_transform = "Standard"
        scene.view_settings.look = "Medium High Contrast"
        scene.view_settings.exposure = -.2
        scene.world = bpy.data.worlds.new("overcast sky")
        scene.world.use_nodes = True
        scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.45, .48, .52, 1)
        scene.world.node_tree.nodes["Background"].inputs[1].default_value = .7
        bpy.ops.object.light_add(type="AREA", location=(-80, -100, 180))
        light = bpy.context.object
        light.data.energy = 190000
        light.data.shape = "DISK"
        light.data.size = 130
        light.rotation_euler = (-light.location).to_track_quat('-Z', 'Y').to_euler()
        bpy.ops.object.camera_add(location=(0, 220*math.sin(settings["tilt"]), 220*math.cos(settings["tilt"])))
        camera = bpy.context.object
        camera.rotation_euler = (-camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera.data.type = "ORTHO"
        camera.data.ortho_scale = settings["worldSize"]
        scene.camera = camera

        depth = bpy.data.materials.new("world depth")
        depth.use_nodes = True
        nodes, links = depth.node_tree.nodes, depth.node_tree.links
        nodes.clear()
        geom = nodes.new("ShaderNodeNewGeometry")
        split = nodes.new("ShaderNodeSeparateXYZ")
        links.new(geom.outputs["Position"], split.inputs[0])
        scale = nodes.new("ShaderNodeMath")
        scale.operation = "MULTIPLY_ADD"
        links.new(split.outputs["Y"], scale.inputs[0])
        scale.inputs[1].default_value = 1/256
        scale.inputs[2].default_value = .5
        emit = nodes.new("ShaderNodeEmission")
        links.new(scale.outputs[0], emit.inputs["Color"])
        out = nodes.new("ShaderNodeOutputMaterial")
        links.new(emit.outputs[0], out.inputs[0])

        bpy.ops.wm.save_as_mainfile(filepath=str(BUILD / (kind + ".blend")))
        for direction in range(settings["directions"]):
            rig.rotation_euler.z = direction * math.tau / settings["directions"]
            for layer in ("base", "upper", "depth"):
                for obj in base:
                    obj.hide_render = layer != "base"
                for obj in upper:
                    obj.hide_render = layer == "base"
                scene.view_layers[0].material_override = depth if layer == "depth" else None
                scene.view_settings.view_transform = "Raw" if layer == "depth" else "Standard"
                scene.view_settings.look = "None" if layer == "depth" else "Medium High Contrast"
                scene.view_settings.exposure = 0 if layer == "depth" else -.2
                scene.render.dither_intensity = 0
                scene.render.filepath = str(BUILD / f"{kind}-{layer}-{direction:02}.png")
                bpy.ops.render.render(write_still=True)
        metadata["ships"][kind] = {**spec, "hull": hull, "deck": deck}
        print("SHIP_BAKED", kind, flush=True)
    target = ROOT / "src/shared/generated/ship-geometry.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(metadata, indent=2) + "\n")


def main():
    from PIL import Image, ImageOps
    from io import BytesIO
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--blender", default=os.environ.get("BLENDER_BIN", "blender"))
    parser.add_argument("--pack-only", action="store_true")
    args = parser.parse_args()
    if not args.pack_only:
        subprocess.run([args.blender, "--background", "--factory-startup", "--python-exit-code", "1",
                        "--python", str(Path(__file__).resolve())], check=True)
    config = json.loads(SOURCE.read_text())
    frame = config["camera"]["frameSize"]
    # Undo the orthographic camera's ground foreshortening. Physical deck x/y
    # therefore matches gameplay x/y at every heading; height still rises on screen.
    cos = math.cos(config["camera"]["tilt"])
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for kind in config["ships"]:
        for layer in ("base", "upper", "depth"):
            atlas = Image.new("RGBA", (frame*8, frame*4))
            for direction in range(config["camera"]["directions"]):
                image = ImageOps.mirror(Image.open(BUILD / f"{kind}-{layer}-{direction:02}.png"))
                stretched = image.resize((frame, round(frame/cos)), Image.Resampling.NEAREST if layer == "depth" else Image.Resampling.LANCZOS)
                image = stretched.crop((0, (stretched.height-frame)//2, frame, (stretched.height+frame)//2))
                atlas.paste(image, (direction%8*frame, direction//8*frame))
            target=OUTPUT / f"{kind}-{layer}.png"
            buffer=BytesIO();atlas.save(buffer, format="PNG", optimize=True);target.write_bytes(buffer.getvalue())
    print("Ship atlases exported to", OUTPUT)


if __name__ == "__main__":
    if "bpy" in sys.modules:
        build_in_blender()
    else:
        main()
