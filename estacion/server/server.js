
import express from 'express';
import mongoose from 'mongoose';
import mqtt from 'mqtt';
import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
const app=express();
app.use(express.json({limit:'64kb'}));
const User=mongoose.model('User',new mongoose.Schema({username:{type:String,unique:true},salt:String,hash:String,role:String}));
const Record=mongoose.model('Record',new mongoose.Schema({id:{type:String,unique:true},time:String,temp:Number,press:Number,alt:Number,lat:Number,lng:Number,mode:String,packet:String}));
await mongoose.connect(process.env.MONGO_URI);
const hash=(p,s)=>scryptSync(p,s,64).toString('hex');
if(!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD==='CAMBIA_ESTA_CLAVE') throw Error('Configura ADMIN_PASSWORD');
const admin=process.env.ADMIN_USER||'admin';
if(!await User.findOne({username:admin})){
 const salt=randomBytes(16).toString('hex');
 await User.create({username:admin,salt,hash:hash(process.env.ADMIN_PASSWORD,salt),role:'admin'});
}
const sessions=new Map(), attempts=new Map();
app.post('/api/login',async(req,res)=>{
 try{
 const ip=req.ip, prev=attempts.get(ip)||{n:0,at:Date.now()};
 if(Date.now()-prev.at>60000){prev.n=0;prev.at=Date.now();}
 attempts.set(ip,prev); if(++prev.n>10)return res.status(429).json({error:'Espera un minuto'});
 const {username,password}=req.body;
 if(typeof username!=='string'||typeof password!=='string'||password.length>128)return res.sendStatus(400);
 const u=await User.findOne({username});
 if(!u||!timingSafeEqual(Buffer.from(u.hash,'hex'),Buffer.from(hash(password,u.salt),'hex')))return res.status(401).json({error:'Credenciales incorrectas'});
 const token=randomBytes(32).toString('hex');
 sessions.set(token,{username:u.username,role:u.role,expires:Date.now()+3600000});
 res.json({token,user:{username:u.username,role:u.role}});
 }catch{res.sendStatus(500);}
});
app.post('/api/register',async(req,res)=>{
 try{
 const {username,password}=req.body;
 if(typeof username!=='string'||!/^[a-zA-Z0-9_-]{3,32}$/.test(username)||typeof password!=='string'||password.length<10||password.length>128)return res.status(400).json({error:'Usuario 3-32 caracteres; clave 10-128'});
 const salt=randomBytes(16).toString('hex');
 await User.create({username,salt,hash:hash(password,salt),role:'user'});
 res.sendStatus(201);
 }catch{res.status(409).json({error:'No se pudo registrar el usuario'});}
});
app.use('/api',(req,res,next)=>{
 const token=(req.headers.authorization||'').replace(/^Bearer /,'');
 const u=sessions.get(token);
 if(!u||u.expires<Date.now())return res.sendStatus(401);
 req.user=u;req.token=token;next();
});
app.post('/api/logout',(req,res)=>{sessions.delete(req.token);res.sendStatus(204);});
app.get('/api/me',(req,res)=>res.json(req.user));
app.get('/api/records',async(req,res)=>{try{res.json(await Record.find().sort({time:-1}).limit(1000).lean());}catch{res.sendStatus(503);}});
const validRecord=r=>['temp','press','lat','lng'].every(k=>typeof r[k]==='number'&&Number.isFinite(r[k]))&&Math.abs(r.lat)<=90&&Math.abs(r.lng)<=180;
app.post('/api/records',async(req,res)=>{
 if(req.user.role!=='admin')return res.sendStatus(403);
 if(!validRecord(req.body))return res.sendStatus(400);
 try{res.json(await Record.create({...req.body,_id:undefined,id:randomBytes(12).toString('hex'),time:new Date().toISOString()}));}catch{res.sendStatus(500);}
});
app.delete('/api/records/:id',async(req,res)=>{
 if(req.user.role!=='admin')return res.sendStatus(403);
 try{await Record.deleteOne({id:req.params.id});res.sendStatus(204);}catch{res.sendStatus(500);}
});
app.patch('/api/records/:id',async(req,res)=>{
 if(req.user.role!=='admin')return res.sendStatus(403);
 if(!validRecord(req.body))return res.sendStatus(400);
 try{const {temp,press,lat,lng,mode}=req.body;res.json(await Record.findOneAndUpdate({id:req.params.id},{temp,press,lat,lng,mode},{new:true}));}catch{res.sendStatus(500);}
});
const prefix=process.env.MQTT_PREFIX||'carrito/gateway01';
const bus=mqtt.connect(process.env.MQTT_URL,{queueQoSZero:false});
const events=[];
bus.on('connect',()=>bus.subscribe([prefix+'/telemetry',prefix+'/ack']));
bus.on('error',e=>console.error('MQTT',e.message));
bus.on('message',async(topic,b)=>{
 if(b.length>4096)return;
 try{
 const data=JSON.parse(b.toString());
 events.push({eventId:randomBytes(12).toString('hex'),topic,data,time:Date.now()});
 if(events.length>200)events.shift();
 if(topic.endsWith('/telemetry')){
 const fields=Object.fromEntries(String(data.packet).split('|').slice(1).map(s=>{const n=s.indexOf('=');return [s.slice(0,n),s.slice(n+1)];}));
 if(fields.SRC!=='CARRITO_01')return;
 const num=k=>fields[k]!==undefined&&fields[k]!==''?Number(fields[k]):NaN;
 const r={id:randomBytes(12).toString('hex'),time:new Date().toISOString(),temp:num('TEMP'),press:num('PRESS'),lat:num('LAT'),lng:num('LNG'),alt:num('ALT'),mode:fields.STATE||'TEL',packet:data.packet};
 if(validRecord(r))await Record.create(r);
 }
 }catch(e){console.error('Recepcion:',e.message);}
});
app.get('/api/events',(req,res)=>res.json({connected:bus.connected,events}));
app.post('/api/command',(req,res)=>{
 if(req.user.role!=='admin')return res.sendStatus(403);
 const {command,speed,duration}=req.body;
 if(!['FORWARD','BACKWARD','LEFT','RIGHT','STOP','ESTOP','STATUS'].includes(command)||!Number.isInteger(speed)||speed<0||speed>100||!Number.isInteger(duration)||duration<0||duration>5000)return res.sendStatus(400);
 if(!['STOP','ESTOP','STATUS'].includes(command)&&duration<100)return res.sendStatus(400);
 if(!bus.connected)return res.status(503).json({error:'Broker desconectado'});
 const payload={id:randomBytes(12).toString('hex'),command,speed,duration,expires:Math.floor(Date.now()/1000)+5};
 bus.publish(prefix+'/command',JSON.stringify(payload),{qos:0,retain:false},err=>{
 if(err)return res.status(503).json({error:'Publicacion fallida'});
 res.json(payload);
 });
});
app.use(express.static('web'));
app.listen(process.env.PORT||8080);
