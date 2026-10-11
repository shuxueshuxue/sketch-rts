// Diagnostic only. Installed on one real layer; originals are restored afterward.
function installArtProfile(layer) {
  const frames=[], restores=[]; let active=null, rasterDepth=0;
  const add=(key,value=1)=>{if(active)active[key]=(active[key]??0)+value;};
  const timed=(key,fn)=>{const at=performance.now();try{return fn();}finally{add(key,performance.now()-at);}};
  const wrap=(object,key,body)=>{const original=object[key];if(typeof original!=='function')throw Error('Missing profile hook '+key);object[key]=function(...args){return body.call(this,original,args);};restores.push(()=>object[key]=original);};
  const cards=layer.cards,renderer=layer.renderer,gl=renderer.getContext(),nativeFinish=gl.finish.bind(gl);
  if(!cards?.cards||!cards?.pages)throw Error('Card cache shape changed');
  window.__artProfileStage={timed,add};
  wrap(cards,'add',function(original,args){const pending=this.pending.length;add('addRequests');const value=original.apply(this,args);add(this.pending.length>pending?'initialMissRequests':'warmCacheHits');return value;});
  wrap(cards,'raster',function(original,args){const request=args[0],miss=!this.cards.has(request.key);add(miss?'uniqueRasterizations':'duplicatePendingResolved');const painted={...request,paint:ctx=>timed('paintMs',()=>request.paint(ctx))};rasterDepth++;try{return timed('rasterMs',()=>original.call(this,painted));}finally{rasterDepth--;}});
  wrap(CanvasRenderingContext2D.prototype,'getImageData',function(original,args){if(!active||!rasterDepth)return original.apply(this,args);add('readbacks');add('readbackBytes',args[2]*args[3]*4);return timed('readbackMs',()=>original.apply(this,args));});
  wrap(cards,'slot',function(original,args){return timed('slotMs',()=>{const result=original.apply(this,args);const old=result.page.cards[result.layer];if(old&&!this.cards.has(old.key))add('slotEvictions');return result;});});
  wrap(cards,'createPage',function(original,args){add('pageAllocations');add('pageAllocatedBytes',args[0]*args[1]*16*4);return timed('pageAllocationMs',()=>original.apply(this,args));});
  wrap(cards,'remove',function(original,args){const page=args[0];add('pageRemovals');add('pageFreedBytes',page.texture.image.width*page.texture.image.height*16*4);add('pageRemovalEvictions',page.cards.filter(c=>c&&this.cards.get(c.key)===c).length);return timed('pageRemovalMs',()=>original.apply(this,args));});
  for(const method of ['compact','finish'])wrap(cards,method,function(original,args){return timed(method+'Ms',()=>original.apply(this,args));});
  const bound=new Map(),dimensions=new Map();
  wrap(gl,'bindTexture',function(original,args){bound.set(args[0],args[1]);return original.apply(this,args);});
  for(const name of ['texStorage3D','texImage3D','texSubImage3D','generateMipmap','drawElements','drawElementsInstanced','drawArrays','drawArraysInstanced','finish']){
    wrap(gl,name,function(original,args){
      if(active){
        add(name+'Calls');
        if(name==='texStorage3D'){const d={width:args[3],height:args[4],depth:args[5]};dimensions.set(bound.get(args[0]),d);add('glAllocatedBaseTexels',d.width*d.height*d.depth);}
        if(name==='texSubImage3D')add('uploadBytes',args[5]*args[6]*args[7]*4);
        if(name==='texImage3D'){const d={width:args[3],height:args[4],depth:args[5]};dimensions.set(bound.get(args[0]),d);add('uploadBytes',d.width*d.height*d.depth*4);}
        if(name==='generateMipmap'){const d=dimensions.get(bound.get(args[0]));if(d)add('mipmapBaseTexels',d.width*d.height*d.depth);else add('mipmapUnknownTextureCalls');}
      }
      if(active&&window.__artFenceGL&&['texSubImage3D','generateMipmap'].includes(name)){
        const pre=performance.now();nativeFinish();const beforeMs=performance.now()-pre;
        add(name+'BeforeFenceMs',beforeMs);
        const at=performance.now();const value=original.apply(this,args);const callMs=performance.now()-at;add(name+'Ms',callMs);
        const post=performance.now();nativeFinish();const afterMs=performance.now()-post;add(name+'AfterFenceMs',afterMs);
        (active.glEvents??=[]).push({name,beforeMs,callMs,afterMs,uploadBytes:name==='texSubImage3D'?args[5]*args[6]*args[7]*4:null});
        return value;
      }
      return timed(name+'Ms',()=>original.apply(this,args));
    });
  }
  wrap(renderer,'render',function(original,args){
    if(active){
      active.dirtyPages=cards.pages.filter(p=>p.texture.layerUpdates.size).length;
      active.dirtyLayers=cards.pages.reduce((n,p)=>n+p.texture.layerUpdates.size,0);
      active.requestedLayerUploadBytes=cards.pages.reduce((n,p)=>n+p.texture.layerUpdates.size*p.texture.image.width*p.texture.image.height*4,0);
      active.fullPageUpload=Boolean(window.__artFullPageUpload);
      // A diagnostic only: empty update-set makes Three upload the unchanged
      // full CPU page. Dimensions, filtering, mips and final texels are retained.
      if(window.__artFullPageUpload)for(const page of cards.pages)if(page.texture.layerUpdates.size)page.texture.clearLayerUpdates();
    }
    return timed('rendererMs',()=>original.apply(this,args));
  });
  return {frames,
    begin(n,tick){active={sample:n,tick,startMs:performance.now(),before:cards.stats()};},
    async completeGpu(){
      const at=performance.now(),sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);if(!sync)throw Error('fenceSync failed');
      gl.flush();let polls=0,status;
      try{
        for(;;){
          status=gl.clientWaitSync(sync,0,0);polls++;
          if(status===gl.ALREADY_SIGNALED||status===gl.CONDITION_SATISFIED)break;
          if(status===gl.WAIT_FAILED||gl.isContextLost())throw Error('GPU completion wait failed');
          if(performance.now()-at>120000)throw Error('GPU completion wait exceeded 120 seconds');
          await new Promise(done=>setTimeout(done,0));
        }
        active.trueGpuTailMs=performance.now()-at;active.completionPolls=polls;active.completionStatus=status;
      }finally{gl.deleteSync(sync);}
    },
    end(){active.endMs=performance.now();active.after=cards.stats();frames.push(active);console.log('ART PROFILE',JSON.stringify(active));active=null;},
    restore(){for(const restore of restores.reverse())restore();delete window.__artProfileStage;},
  };
}
