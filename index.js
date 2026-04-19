const fs = require("fs");
const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");
const app = express();
app.use(express.json());
const serviceAccount = JSON.parse(fs.readFileSync("/home/ubuntu/firebase-key.json","utf8"));
admin.initializeApp({credential:admin.credential.cert(serviceAccount)});
const db = admin.firestore();
console.log("Firebase OK");
const EURL = "http://localhost:8080";
const EKEY = "minha-chave-secreta-2026";
const EINST = "mensalidade";
async function send(num,txt){try{await axios.post(EURL+"/message/sendText/"+EINST,{number:num,text:txt},{headers:{apikey:EKEY}});}catch(e){console.error("send err",e.message);}}
function tel(t){return String(t||"").replace(/\D/g,"");}
function mes(){const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");}
async function getUser(telefone){const t=tel(telefone);const s=await db.collection("tenants").get();for(const d of s.docs){if(!d.data().ativo)continue;for(const c of["usuarios","usuario"]){try{const u=await db.collection("tenants").doc(d.id).collection(c).get();const f=u.docs.find(x=>tel(x.data().telefone)===t);if(f)return{id:f.id,tenantId:d.id,nome:d.data().nome,...f.data()};}catch(e){}}}return null;}
app.get("/ping",(q,r)=>r.json({ok:true}));
app.post("/webhook",async(q,r)=>{
  r.sendStatus(200);
  try{
    const b=q.body;const ev=b.event||b.type;
    if(ev!=="messages.upsert"&&ev!=="MESSAGES_UPSERT")return;
    const m=b.data&&b.data.messages&&b.data.messages[0]||b.messages&&b.messages[0];
    if(!m||m.key.fromMe||!m.message)return;
    const txt=m.message.conversation||m.message.extendedTextMessage&&m.message.extendedTextMessage.text||"";
    if(!txt)return;
    const num=m.key.remoteJid.replace("@s.whatsapp.net","");
    console.log("MSG "+num+": "+txt);
    const u=await getUser(num);
    if(!u){await send(num,"Numero nao autorizado.");return;}
    const cmd=txt.trim().toLowerCase().split(/\s+/)[0];
    if(cmd==="ajuda"||cmd==="menu"){await send(num,"Comandos:\n- status [nome]\n- alunos\n- cursos\n- pago [nome]\n- despago [nome]");return;}
    await send(num,"Comando recebido: "+cmd);
    console.log("OK "+u.nome);
  }catch(e){console.error("ERR",e.message);}
});
process.on("uncaughtException",e=>console.error("EXC",e.message));
app.listen(3000,()=>console.log("Porta 3000"));
