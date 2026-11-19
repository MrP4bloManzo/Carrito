
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
function setup(){
 const elements=new Map(),calls=[];
 const el=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',children:[],classList:{add(){},remove(){}},appendChild(e){this.children.push(e);},remove(){}});return elements.get(id);};
 const context=vm.createContext({window:{addEventListener(){}},document:{addEventListener(){},getElementById:el,createElement:()=>el(Math.random()),querySelectorAll:()=>[]},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},fetch:async(...a)=>{calls.push(a);return {ok:false,status:401};},setTimeout(){},setInterval(){},clearInterval(){},FileReader:function(){this.readAsText=f=>this.onload({target:{result:f.content}});}});
 vm.runInContext(source,context);return {app:context.window.app,calls,elements,el};
}
test('una sesion inexistente no publica movimientos',async()=>{const s=setup();await s.app.sendDriveCommand('FORWARD');assert.equal(s.calls.length,0);});
test('login rechazado no publica comandos',async()=>{const s=setup();s.el('username').value='admin';s.el('password').value='incorrecta';await s.app.handleLogin();await s.app.sendDriveCommand('FORWARD');assert.equal(s.calls.length,1);assert.equal(s.calls[0][0],'/api/login');});
test('CSV sin datos se rechaza antes de crear mapas',()=>{const s=setup();s.app.handleSDFileUpload({target:{files:[{content:'time,temp,press,lat,lng\n'}]}});assert.match(s.el('toastContainer').children[0].textContent,/CSV vacio/);});
test('todas las acciones HTML existen',()=>{const s=setup();const html=fs.readFileSync(new URL('../web/index.html',import.meta.url),'utf8');for(const m of html.matchAll(/window\.app\.(\w+)\s*\(/g))assert.equal(typeof s.app[m[1]],'function',m[1]);});
