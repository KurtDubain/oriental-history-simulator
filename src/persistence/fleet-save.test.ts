import {afterEach,describe,expect,it,vi} from 'vitest';
import {advanceWorld,advanceWorldBy,createWorld,serializeWorld,deserializeWorld,validateTurnRuntime,validateWorld} from '../sim';
import {createAutosaveCoordinator} from './autosave-coordinator';
import {createSaveEnvelope,saveWorld,saveWorldToSlot,loadWorld,saveFailureMessage} from './storage';

// Only the browser IO is replaced: coordinator, serialization, envelope and
// storage transaction code all run. Production browser coverage uses real IDB.
function memoryIDB(){
 const slots=new Map();let puts=0;
 vi.stubGlobal('indexedDB',{open:()=>{
  const open:any={};queueMicrotask(()=>{open.result={objectStoreNames:{contains:()=>true},close:()=>{},transaction:()=>{
   const tx:any={};tx.objectStore=()=>({put:(value:any,key:string)=>request(()=>{slots.set(key,structuredClone(value));puts++;return key}),get:(key:string)=>request(()=>slots.get(key)),count:(key:string)=>request(()=>slots.has(key)?1:0),getAllKeys:()=>request(()=>[...slots.keys()])});
   function request(fn:()=>unknown){const req:any={};queueMicrotask(()=>{req.result=fn();req.onsuccess?.();tx.oncomplete?.()});return req}return tx;
  }};open.onsuccess?.()});return open;
 }});return {slots,puts:()=>puts};
}
afterEach(()=>vi.unstubAllGlobals());
describe('active fleet stock at runtime and durable save boundary',()=>{
 it('rejects a bad automatic snapshot, keeps the real old slot and resumes later valid writes',async()=>{
  const io=memoryIDB(),good=advanceWorldBy(createWorld('舰队保存边界'),8),payload=serializeWorld(good);
  const original=await saveWorld(payload),bad=advanceWorld(good),fleet=bad.fleets[0];
  fleet.warships=fleet.transports=fleet.patrolShips=0;
  expect(validateWorld(bad).some(v=>v.code==='fleet.stock')).toBe(true);
  expect(validateTurnRuntime(good,bad).some(v=>v.code==='fleet.stock')).toBe(true);
  const saved=vi.fn(),errors:any[]=[];
  const actual=createAutosaveCoordinator({initialSavedTurn:8,clock:{now:()=>10000,setTimeout:()=>1,clearTimeout:()=>{}},save:p=>saveWorld(p),onSaved:saved,onError:e=>errors.push(e)});
  actual.markDirty({turn:9,serialize:()=>serializeWorld(bad)});
  expect((await actual.flush('background')).status).toBe('failed');
  expect(actual.getState().lastSavedTurn).toBe(8);expect(saved).not.toHaveBeenCalled();
  expect(await loadWorld()).toEqual(original);expect(io.puts()).toBe(1);
  expect(serializeWorld(deserializeWorld((await loadWorld())!.payload))).toBe(payload);
  expect(saveFailureMessage(errors[0],actual.getState().lastSavedTurn)).toContain('校验未通过，当前进度未保存');
  expect(saveFailureMessage(errors[0],8)).toContain('第3年春');
  const invalid=serializeWorld(bad);
  expect(()=>createSaveEnvelope(invalid)).toThrow(/校验/);
  // Manual save/export/collection use App's full validation before encoding;
  // encodeWorldFile itself is only the portable serializer, not that UI guard.
  expect(validateWorld(bad).some(v=>v.code==='fleet.stock')).toBe(true);
  await expect(saveWorldToSlot(invalid,'invalid')).rejects.toThrow();
  expect(io.puts()).toBe(1);
  const next=advanceWorld(good);actual.markDirty({turn:next.turn,serialize:()=>serializeWorld(next)});
  expect((await actual.flush('manual')).status).toBe('saved');
  expect(actual.getState().lastSavedTurn).toBe(9);expect(saved).toHaveBeenCalledTimes(1);
  expect(serializeWorld(deserializeWorld((await loadWorld())!.payload))).toBe(serializeWorld(next));
  actual.dispose();
 });
 it.each(['zero-sailors','negative-food','fractional-hull','negative-hull','unsafe-sailors'] as const)('keeps full and storage rejection for %s',kind=>{
  const world=createWorld('库存完整合同'),f=world.fleets[0];
  if(kind==='zero-sailors')f.sailors=0;if(kind==='negative-food')f.food=-1;
  if(kind==='fractional-hull')f.transports=.5;if(kind==='negative-hull')f.patrolShips=-1;
  if(kind==='unsafe-sailors')f.sailors=Number.MAX_SAFE_INTEGER+1;
  expect(validateWorld(world).some(v=>v.code==='fleet.stock')).toBe(true);
  expect(()=>createSaveEnvelope(serializeWorld(world))).toThrow(/校验/);
 });
});
