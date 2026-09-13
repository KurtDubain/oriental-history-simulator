// Original procedural cues, no recordings/samples. CC0; see SOURCES.md.
// Run from repository root; encode-audio.py produces the final MP3 files.
import {mkdirSync, writeFileSync} from 'node:fs';
const rate=44100, dir='output/first-media-v1.29.25/audio';
mkdirSync(dir,{recursive:true}); mkdirSync('public/media/sfx',{recursive:true});
const cues=[['quarter-step',.18],['folio-open',.32],['battle-seal',.65],['accession',.85],['farewell',1.1]];
const metrics=[];
for(const [name,duration] of cues){
 let seed=74821, low=0, peak=0, energy=0;
 const n=Math.ceil(rate*duration), wav=Buffer.alloc(44+2*n);
 wav.write('RIFF');wav.writeUInt32LE(36+2*n,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(2*n,40);
 for(let i=0;i<n;i++){
  const t=i/rate;seed=(Math.imul(seed,1664525)+1013904223)>>>0; const noise=seed/2147483648-1;low+=.14*(noise-low);
  const tone=(f,d)=>Math.sin(2*Math.PI*f*t)*Math.exp(-t/d);
  let x=name==='quarter-step'?.24*tone(510,.025)+.12*low*Math.exp(-t/.03)
   :name==='folio-open'?.3*low*Math.sin(Math.PI*t/duration)**2*(.6+.4*Math.sin(2*Math.PI*17*t))
   :name==='battle-seal'?.27*Math.sin(2*Math.PI*(115*t+8*(1-Math.exp(-t/0.035))))*Math.exp(-t/.13)+.09*low*Math.exp(-t/.035)
   :name==='accession'?.15*tone(620,.21)+.075*tone(936,.16)+.04*tone(1631,.12)
   :.19*tone(246,.28)+.065*tone(393,.22)+.025*tone(668,.17);
  x*=Math.min(1,t/.006,(duration-t)/.04);peak=Math.max(peak,Math.abs(x));energy+=x*x;wav.writeInt16LE(Math.round(x*32767),44+2*i);
 }
 const source=`${dir}/${name}.wav`;writeFileSync(source,wav);
 metrics.push({name,duration,peakDb:20*Math.log10(peak),rmsDb:10*Math.log10(energy/n)});
}
writeFileSync(`${dir}/synthesis.json`,JSON.stringify(metrics,null,2));
