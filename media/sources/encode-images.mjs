// Resize/encode final generated artwork; no semantic alteration or new dependency.
import {chromium} from 'playwright';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const base='/Users/mutu/.codex/generated_images/01a03407-36c0-73f0-9ddf-218d4d7c83fa/';
const images=[['river-margin','exec-c864bf7b-a619-44d6-8567-15da4fb86332.png',768],['river-seal','exec-0b17835d-78a0-4953-9d39-5ea6e8635a08.png',160]];
mkdirSync('public/media/images',{recursive:true});
const browser=await chromium.launch();
try{const page=await browser.newPage();for(const[name,file,width]of images){
 const data=await page.evaluate(async({src,width})=>{const img=new Image();img.src=src;await img.decode();const c=document.createElement('canvas');c.width=width;c.height=Math.round(width*img.height/img.width);c.getContext('2d').drawImage(img,0,0,c.width,c.height);return c.toDataURL('image/webp',.8).split(',')[1];},{src:'data:image/png;base64,'+readFileSync(base+file).toString('base64'),width});
 writeFileSync(`public/media/images/${name}.webp`,Buffer.from(data,'base64'));
}}finally{await browser.close();}
