#!/usr/bin/env python3
"""Rebuild every authored building in Blender, with shared subdued materials.

Exports editable .blend scenes. Runtime models use export-world-gltf.py.
Geometry comes from export-building-geometry.ts.
"""
import argparse
import math
import os
from pathlib import Path
import subprocess
import sys
import json

ROOT=Path(__file__).resolve().parents[2]
BUILD=ROOT/".art-build/buildings"

def render():
    import bpy
    from mathutils import Vector
    models=json.loads((BUILD/"geometry.json").read_text())
    selected=os.environ.get("SKETCH_BUILDING_KINDS", "").split(",")
    if selected != [""]:
        models={kind:models[kind] for kind in selected}
    for kind,faces in models.items():
        bpy.ops.wm.read_factory_settings(use_empty=True)
        materials={}
        def material(color):
            key=color
            if key in materials:return materials[key]
            m=bpy.data.materials.new("team flag" if color=="#ff00ff" else color)
            m.use_nodes=True
            c=(.36,.39,.37) if color=="#ff00ff" else tuple((int(color[i:i+2],16)/255)**2.2 for i in (1,3,5))
            p=m.node_tree.nodes.get("Principled BSDF")
            p.inputs["Base Color"].default_value=(*c,1)
            p.inputs["Roughness"].default_value=.82
            p.inputs["Metallic"].default_value=.35 if color in ("#86948f","#b3825d","#d2b779") else 0
            materials[key]=m
            return m
        objects=[]
        for i,face in enumerate(faces):
            mesh=bpy.data.meshes.new(f"face {i}")
            points=face["p"]
            winding=list(range(len(points)))
            if (Vector(points[1])-Vector(points[0])).cross(Vector(points[2])-Vector(points[0])).dot(Vector(face["normal"])) < 0: winding.reverse()
            mesh.from_pydata(points,[],[winding])
            mesh.update()
            obj=bpy.data.objects.new(f"face {i}",mesh);bpy.context.collection.objects.link(obj)
            obj.data.materials.append(material(face["color"]))
            objects.append((obj,face["color"]))
        scene=bpy.context.scene
        scene.render.engine="CYCLES";scene.cycles.device="CPU";scene.cycles.samples=512;scene.cycles.use_denoising=False
        scene.render.threads_mode="FIXED";scene.render.threads=4
        scene.render.resolution_x=scene.render.resolution_y=256;scene.render.resolution_percentage=100
        scene.render.film_transparent=True;scene.render.image_settings.color_mode="RGBA";scene.render.image_settings.file_format="PNG"
        scene.view_settings.view_transform="Standard";scene.view_settings.look="Medium High Contrast";scene.view_settings.exposure=-.15
        scene.world=bpy.data.worlds.new("soft daylight");scene.world.use_nodes=True
        scene.world.node_tree.nodes["Background"].inputs[0].default_value=(.45,.48,.52,1)
        scene.world.node_tree.nodes["Background"].inputs[1].default_value=.8
        bpy.ops.object.light_add(type="AREA",location=(-90,-110,190))
        lamp=bpy.context.object;lamp.data.energy=180000;lamp.data.size=60
        lamp.rotation_euler=(-lamp.location).to_track_quat('-Z','Y').to_euler()
        # A stable oblique architectural view, independent of the unit's heading.
        bpy.ops.object.camera_add(location=(100,144,155))
        camera=bpy.context.object
        target=Vector((0,0,18))
        camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
        camera.data.type="ORTHO";camera.data.ortho_scale=128;scene.camera=camera
        # Cycles catches the building's actual cast/contact shadow on a
        # transparent ground. It shares the model's projection and light.
        bpy.ops.mesh.primitive_plane_add(size=600,location=(0,0,-.1))
        ground=bpy.context.object;ground.name="transparent shadow ground"
        ground.is_shadow_catcher=True
        ground.data.materials.append(material("#b4b4b4"))
        bpy.ops.wm.save_as_mainfile(filepath=str(BUILD/f"{kind}.blend"))
        print("BUILDING_MODEL",kind,flush=True)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--blender',default=os.environ.get('BLENDER_BIN','blender'))
    p.add_argument('--kinds',nargs='+',help='Build only these building kinds')
    args=p.parse_args()
    subprocess.run(['node','--import','tsx','tools/art/export-building-geometry.ts'],cwd=ROOT,check=True)
    subprocess.run([args.blender,'--background','--factory-startup','--python-exit-code','1','--python',str(Path(__file__).resolve())],check=True,
                   env={**os.environ,"SKETCH_BUILDING_KINDS":','.join(args.kinds or [])})
    print('Building models exported to',BUILD)

if __name__=='__main__':
    if 'bpy' in sys.modules:render()
    else:main()
