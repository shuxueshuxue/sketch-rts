import { performance } from "node:perf_hooks";
import { createGame } from "../src/shared/sim";
import { createAiRuntime, createPresetAiRuntimeFramePlanner } from "../src/ai/runtime";
import { CommandFrameRuntime } from "../src/shared/sim/command-frame-runtime";
import { checksumGame } from "../src/shared/sim/checksum";
import { seconds, SIM_TICKS_PER_SECOND } from "../src/shared/time";

// Product command admission, AI planning and simulation; no SDK shortcut.
const players=["player","ai-v5","ai-v7","ai-v8"],aiPlayers=players.slice(1);
const createdAt=performance.now();
const game=createGame("brokenSea",{players,aiPlayers,teams:Object.fromEntries(players.map(id=>[id,id])),races:{player:"grove","ai-v5":"grove","ai-v7":"ember","ai-v8":"grove"}});
const initializedMs=performance.now()-createdAt;
const runtime=new CommandFrameRuntime({game,roomId:"navigation-benchmark",rejectionLabel:"navigation-benchmark",aiPlanner:createPresetAiRuntimeFramePlanner(game,createAiRuntime(aiPlayers,{versions:{"ai-v5":"v5","ai-v7":"v7","ai-v8":"v8"}}))});
const samples:number[]=[];let firstStepMs=0,worstStep=0,peakMs=0;
for(let i=0;i<seconds(15*60)&&!game.match.winner;i++){
  const start=performance.now();runtime.tick([]);const ms=performance.now()-start;
  if(i===0)firstStepMs=ms;
  else {samples.push(ms);if(ms>peakMs){peakMs=ms;worstStep=game.tick;}}
  if(game.tick%seconds(150)===0)process.stdout.write(JSON.stringify({simulatedSeconds:game.tick/SIM_TICKS_PER_SECOND,peakMs,units:game.units.length})+"\n");
}
samples.sort((a,b)=>a-b);
process.stdout.write(JSON.stringify({initializedMs,firstStepMs,active:{peakMs,worstStep,p99Ms:samples[Math.floor(samples.length*.99)],averageMs:samples.reduce((sum,ms)=>sum+ms,0)/samples.length,over50ms:samples.filter(ms=>ms>50).length},simulatedSeconds:game.tick/SIM_TICKS_PER_SECOND,units:game.units.length,ships:game.units.filter(unit=>unit.sailing).length,buildings:game.buildings.length,checksum:checksumGame(game)})+"\n");
