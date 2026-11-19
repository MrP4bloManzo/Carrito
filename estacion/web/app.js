/**
 * Estación Geoespacial de Reconocimiento - Frontend SPA (Lógica Principal)
 * Universidad de Colima - Entornos Inteligentes
 */

(function () {
  'use strict';

  const state = {
    user: null,
    activeTab: 'tab-inicio',
    controlMode: 'manual',
    currentPwm: 75,
    liveTelemetry: {
      temp: null, pressure: null, alt: null, lat: null, lng: null
    },
    livePath: [],
    targetCoords: null,
    dbRecords: []
  };

  let liveMap, liveMarker, livePolyline;
  let autoMap, autoTargetMarker;
  let sdMap, sdPolyline;
  let liveChart, sdChart;
  let liveInterval = null;

  document.addEventListener('DOMContentLoaded', () => {
    checkSavedSession();
    startClock();
    initJoystick();
    initKeyboardListeners();
  });


  let token=sessionStorage.getItem('geo_token')||'';
  let poll=null;
  const seenEvents=new Set();
  async function api(path,method='GET',body) {
    const r=await fetch('/api/'+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:body?JSON.stringify(body):undefined});
    if(!r.ok)throw Error('Error '+r.status);
    return r.status===204?null:r.json();
  }
  async function checkSavedSession() {
    if(!token)return;
    try{state.user=await api('me');showMainApp();}catch{token='';sessionStorage.removeItem('geo_token');}
  }
  async function handleLogin() {
    try{
      const result=await api('login','POST',{username:document.getElementById('username').value.trim(),password:document.getElementById('password').value});
      token=result.token;sessionStorage.setItem('geo_token',token);state.user=result.user;showMainApp();
    }catch{showToast('No fue posible iniciar sesion','error');}
  }
  async function handleLogout() {
    if(state.user?.role==='admin')await sendDriveCommand('STOP');
    try{await api('logout','POST');}catch{}
    token='';sessionStorage.removeItem('geo_token');state.user=null;
    clearInterval(poll);poll=null;
    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('authScreen').classList.remove('hidden');
  }
  async function refreshRecords(){
    try{state.dbRecords=await api('records');renderDbTable();}catch{showToast('No se pudo consultar MongoDB','error');}
  }
  function startEvents(){
    clearInterval(poll);
    poll=setInterval(async()=>{
      try{
        const result=await api('events');
        document.getElementById('mqttStatusLabel').textContent=result.connected?'Broker conectado':'Broker desconectado';
        for(const event of result.events){
          if(seenEvents.has(event.eventId))continue;
          seenEvents.add(event.eventId);
          if(seenEvents.size>500)seenEvents.delete(seenEvents.values().next().value);
          if(Date.now()-event.time>16000)continue;
          if(event.topic.endsWith('/ack'))showToast('Comando '+event.data.id+': '+event.data.status,'info');
          if(event.topic.endsWith('/telemetry')){
            const fields=Object.fromEntries(event.data.packet.split('|').slice(1).map(x=>x.split('=')));
            for(const [key,field] of Object.entries({temp:'TEMP',pressure:'PRESS',alt:'ALT',lat:'LAT',lng:'LNG'})){
              const v=fields[field];
              if(v!==undefined&&v!==''&&Number.isFinite(Number(v)))state.liveTelemetry[key]=Number(v);
            }
            for(const [id,key] of Object.entries({'metric-temp':'temp','metric-press':'pressure','metric-alt':'alt','metric-lat':'lat','metric-lng':'lng'}))
              document.getElementById(id).textContent=state.liveTelemetry[key]??'Sin datos';
            const {lat,lng}=state.liveTelemetry;
            if(Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180){
              const pos=[lat,lng];liveMarker.setLatLng(pos);state.livePath.push(pos);
              if(state.livePath.length>1000)state.livePath.shift();
              livePolyline.setLatLngs(state.livePath);
            }
            liveChart.data.labels.push(new Date(event.time).toLocaleTimeString());
            liveChart.data.datasets[0].data.push(state.liveTelemetry.temp);
            liveChart.data.datasets[1].data.push(state.liveTelemetry.pressure);
            if(liveChart.data.labels.length>60){liveChart.data.labels.shift();liveChart.data.datasets.forEach(d=>d.data.shift());}
            liveChart.update('none');
            refreshRecords();
          }
        }
      }catch{document.getElementById('mqttStatusLabel').textContent='Sin conexion al servidor';}
    },1000);
  }
  function showMainApp() {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');

    document.getElementById('displayUsername').textContent = state.user.username;
    document.getElementById('displayRoleBadge').textContent = state.user.role.toUpperCase();
    document.getElementById('userAvatar').textContent = state.user.username.charAt(0).toUpperCase();

    if (state.user.role === 'user') {
      document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
    } else {
      document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    }

    renderDbTable();
    initMapsAndCharts();
    refreshRecords();
    startEvents();
    
    // Inicializar el servicio MQTT externo si está disponible
    if (window.mqttService && typeof window.mqttService.init === 'function') {
      window.mqttService.init();
    }
  }

  function startClock() {
    setInterval(() => {
      const now = new Date();
      document.getElementById('liveClock').textContent = now.toISOString().substring(11, 19) + ' UTC';
    }, 1000);
  }

  function switchTab(tabId) {
    state.activeTab = tabId;
    ['tab-inicio', 'tab-monitoreo', 'tab-base-datos', 'tab-control'].forEach(id => {
      document.getElementById(id).classList.add('hidden');
      const navBtn = document.getElementById(`nav-${id}`);
      if (navBtn) {
        navBtn.classList.remove('text-emerald-400', 'bg-emerald-500/10', 'border', 'border-emerald-500/20');
        navBtn.classList.add('text-slate-400');
      }
    });

    document.getElementById(tabId).classList.remove('hidden');
    const activeBtn = document.getElementById(`nav-${tabId}`);
    if (activeBtn) {
      activeBtn.classList.add('text-emerald-400', 'bg-emerald-500/10', 'border', 'border-emerald-500/20');
      activeBtn.classList.remove('text-slate-400');
    }

    const titles = {
      'tab-inicio': 'Inicio / Portada Institucional',
      'tab-monitoreo': 'Monitoreo Telemetría en Tiempo Real',
      'tab-base-datos': 'Análisis, Base de Datos & Datalogger SD',
      'tab-control': 'Gestión y Control Remoto (Dual)'
    };
    document.getElementById('currentTabTitle').textContent = titles[tabId];

    setTimeout(() => {
      if (tabId === 'tab-monitoreo' && liveMap) liveMap.invalidateSize();
      if (tabId === 'tab-control' && autoMap) autoMap.invalidateSize();
      if (tabId === 'tab-base-datos' && sdMap) sdMap.invalidateSize();
    }, 200);
  }

  function initMapsAndCharts() {
    const colimaCoords = [19.2433, -103.7247];

    if (!liveMap) {
      liveMap = L.map('liveMap').setView(colimaCoords, 16);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(liveMap);
      liveMarker = L.marker(colimaCoords).addTo(liveMap).bindPopup('<b>Rover ESP32</b>');
      livePolyline = L.polyline([], { color: '#10b981', weight: 4 }).addTo(liveMap);
    }

    if (!autoMap) {
      autoMap = L.map('autoMap').setView(colimaCoords, 16);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(autoMap);
      autoMap.on('click', (e) => {
        state.targetCoords = e.latlng;
        if (autoTargetMarker) autoMap.removeLayer(autoTargetMarker);
        autoTargetMarker = L.marker(e.latlng).addTo(autoMap).bindPopup('Destino Fijado').openPopup();
        showToast('Waypoint seleccionado', 'info');
      });
    }

    if (!liveChart) {
      const ctx = document.getElementById('liveChart').getContext('2d');
      liveChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            { label: 'Temp (°C)', data: [], borderColor: '#f43f5e', tension: 0.3 },
            { label: 'Presión (hPa)', data: [], borderColor: '#6366f1', tension: 0.3 }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false }
      });
    }
  }

  function recenterLiveMap() {
    if (liveMap && liveMarker) liveMap.setView(liveMarker.getLatLng(), 17);
  }

  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function renderDbTable(records = state.dbRecords) {
    const tbody = document.getElementById('dbTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    records.forEach(rec => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-950/50 transition';
      tr.innerHTML = `
        <td class="p-3 font-bold text-emerald-400">${rec.id}</td>
        <td class="p-3 text-slate-400">${escapeHtml(rec.time)}</td>
        <td class="p-3 text-white">${rec.temp} °C</td>
        <td class="p-3 text-white">${rec.press} hPa</td>
        <td class="p-3 text-slate-300">${rec.lat.toFixed(4)}, ${rec.lng.toFixed(4)}</td>
        <td class="p-3"><span class="px-2 py-0.5 text-[10px] rounded font-bold bg-amber-500/10 text-amber-400">${escapeHtml(rec.mode)}</span></td>
        <td class="p-3 text-right"><button onclick="window.app.deleteRecord('${rec.id}')" class="admin-only text-rose-400"><i class="fa-solid fa-trash"></i></button></td>
      `;
      tbody.appendChild(tr);
    });
    if (state.user && state.user.role === 'user') {
      document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
    }
  }

  function filterTable() {
    const q = document.getElementById('dbSearch').value.toLowerCase();
    const mode = document.getElementById('dbFilterMode').value;
    const filtered = state.dbRecords.filter(r => (r.id.toLowerCase().includes(q) || r.temp.toString().includes(q)) && (mode === 'ALL' || r.mode === mode));
    renderDbTable(filtered);
  }

  // Función principal de movimiento que interactúa con la BD/SD y delega el envío a MQTT

  async function sendDriveCommand(command) {
    if(state.user?.role!=='admin')return;
    try{
      const stop=command==='STOP'||command==='ESTOP'||command==='STATUS';
      const result=await api('command','POST',{command,speed:stop?0:Number(state.currentPwm),duration:stop?0:500});
      showToast('Publicado '+result.id+'; esperando CACK','info');
      setTimeout(()=>{showToast('Verifica CACK para '+result.id+'; publicar no confirma ejecucion','info');},8500);
    }catch{showToast('Comando no publicado','error');}
  }
  function updatePWM(val) {
    state.currentPwm = val;
    document.getElementById('pwmValue').textContent = `${val}%`;
  }

  function initKeyboardListeners() {
    window.addEventListener('keydown', (e) => {
      if (!state.user || state.activeTab !== 'tab-control' || state.controlMode !== 'manual') return;
      if(e.repeat || /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName))return;
      const key = e.key.toUpperCase();
      if (['W', 'A', 'S', 'D', 'ARROWUP', 'ARROWDOWN', 'ARROWLEFT', 'ARROWRIGHT'].includes(key)) e.preventDefault();

      if (key === 'W' || key === 'ARROWUP') sendDriveCommand('FORWARD');
      else if (key === 'S' || key === 'ARROWDOWN') sendDriveCommand('BACKWARD');
      else if (key === 'A' || key === 'ARROWLEFT') sendDriveCommand('LEFT');
      else if (key === 'D' || key === 'ARROWRIGHT') sendDriveCommand('RIGHT');
    });
  }

  window.addEventListener('keyup',e=>{if(['w','a','s','d','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))sendDriveCommand('STOP');});
  window.addEventListener('blur',()=>sendDriveCommand('STOP'));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)sendDriveCommand('STOP');});
  function initJoystick() {
    const canvas = document.getElementById('joystickCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let dragging = false;
    const center = { x: canvas.width / 2, y: canvas.height / 2 };
    const maxRadius = 70;
    let stick = { x: center.x, y: center.y };

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.beginPath(); ctx.arc(center.x, center.y, maxRadius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(30, 41, 59, 0.5)'; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(stick.x, stick.y, 25, 0, Math.PI * 2);
      ctx.fillStyle = '#10b981'; ctx.fill();
    }

    let lastMove=0;
    canvas.addEventListener('pointerdown',e=>{dragging=true;canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{
      if(!dragging||Date.now()-lastMove<600)return;
      lastMove=Date.now();
      const r=canvas.getBoundingClientRect(),x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2;
      sendDriveCommand(Math.hypot(x,y)<15?'STOP':Math.abs(x)>Math.abs(y)?(x>0?'RIGHT':'LEFT'):(y>0?'BACKWARD':'FORWARD'));
    });
    const release=()=>{dragging=false;sendDriveCommand('STOP');};
    canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
    window.addEventListener('mouseup', () => { dragging = false; stick = { x: center.x, y: center.y }; draw(); });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const rect = canvas.getBoundingClientRect();
      const dx = e.clientX - rect.left - center.x;
      const dy = e.clientY - rect.top - center.y;
      const dist = Math.hypot(dx, dy);
      if (dist < maxRadius) { stick.x = center.x + dx; stick.y = center.y + dy; }
      draw();
    });
    draw();
  }

  function handleSDFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      const lines = e.target.result.trim().split('\n');

      const header=lines[0].split(',').map(s=>s.trim().toLowerCase());
      const find=(names)=>header.findIndex(h=>names.includes(h));
      const ti=find(['time','timestamp']),te=find(['temp','temperature']),pr=find(['press','pressure']),la=find(['lat','latitude']),lo=find(['lng','longitude']);
      if([ti,te,pr,la,lo].some(i=>i<0))return showToast('CSV: faltan columnas requeridas','error');
      const parsed=lines.slice(1).filter(l=>l.trim()).map(l=>{
        const p=l.split(',');return {time:p[ti],temp:Number(p[te]),press:Number(p[pr]),lat:Number(p[la]),lng:Number(p[lo])};
      });
      if(!parsed.length||parsed.some(p=>![p.temp,p.press,p.lat,p.lng].every(Number.isFinite)||Math.abs(p.lat)>90||Math.abs(p.lng)>180))
        return showToast('CSV vacio o con valores invalidos','error');
      if(sdChart)sdChart.destroy();
      sdChart=new Chart(document.getElementById('sdChart').getContext('2d'),{type:'line',data:{labels:parsed.map(p=>p.time),datasets:[{label:'Temperatura',data:parsed.map(p=>p.temp),borderColor:'#f43f5e'},{label:'Presion',data:parsed.map(p=>p.press),borderColor:'#6366f1'}]},options:{responsive:true,maintainAspectRatio:false}});
      document.getElementById('sdAnalysisContainer').classList.remove('hidden');
      document.getElementById('sdFileName').textContent = file.name;
      document.getElementById('sdFileStats').textContent = `${parsed.length} puntos procesados`;
      
      setTimeout(() => {
        if (!sdMap) {
          sdMap = L.map('sdMap').setView([parsed[0].lat, parsed[0].lng], 16);
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(sdMap);
        }
        if (sdPolyline) sdMap.removeLayer(sdPolyline);
        sdPolyline = L.polyline(parsed.map(p => [p.lat, p.lng]), { color: '#f59e0b', weight: 4 }).addTo(sdMap);
        sdMap.fitBounds(sdPolyline.getBounds());
      }, 200);
      showToast('MicroSD procesada con éxito', 'success');
    };
    reader.readAsText(file);
  }

  function exportData(type) {
    const content = type === 'json' ? JSON.stringify(state.dbRecords, null, 2) : 'id,time,temp,press,lat,lng,mode\n' + state.dbRecords.map(r => `${r.id},${r.time},${r.temp},${r.press},${r.lat},${r.lng},${r.mode}`).join('\n');
    const blob = new Blob([content], { type: type === 'json' ? 'application/json' : 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `telemetry.${type}`; a.click();
    showToast(`Exportado a ${type.toUpperCase()}`, 'success');
  }

  function deleteRecord(id) {
    if (state.user.role !== 'admin') return showToast('Acceso denegado', 'error');
    api('records/'+encodeURIComponent(id),'DELETE').then(refreshRecords).catch(()=>showToast('No se pudo eliminar','error'));
    renderDbTable();
    showToast(`Registro ${id} eliminado`, 'info');
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    const colors = { success: 'bg-emerald-950 border-emerald-500/40 text-emerald-200', error: 'bg-rose-950 border-rose-500/40 text-rose-200', info: 'bg-slate-900 border-slate-700 text-slate-200' };
    toast.className = `toast-enter pointer-events-auto border rounded-xl px-4 py-3 text-xs font-medium shadow-xl flex items-center space-x-3 max-w-sm ${colors[type]}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3500);
  }

  window.app = {
    register: async()=>{try{
      const r=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:document.getElementById('username').value.trim(),password:document.getElementById('password').value})});
      if(!r.ok)throw Error();showToast('Usuario creado; inicia sesion','success');
    }catch{showToast('Registro rechazado: usuario 3-32, clave minimo 10 caracteres','error');}},
    handleLogin, handleLogout, switchTab, recenterLiveMap, filterTable,
    openCreateModal: () => document.getElementById('crudModal').classList.remove('hidden'),
    closeCrudModal: () => document.getElementById('crudModal').classList.add('hidden'),
    saveCrudRecord: async () => {
      try{await api('records','POST',{temp:Number(document.getElementById('inputTemp').value),press:Number(document.getElementById('inputPress').value),lat:Number(document.getElementById('inputLat').value),lng:Number(document.getElementById('inputLng').value),mode:document.getElementById('inputMode').value});await refreshRecords();}catch{showToast('Registro invalido o sin permisos','error');return;}
      document.getElementById('crudModal').classList.add('hidden');
      renderDbTable();
      showToast('Creado con éxito', 'success');
    },
    deleteRecord, exportData, handleSDFileUpload,
    setControlMode: (m) => { if(m==='auto')return showToast('El firmware actual no declara navegacion por waypoints','info'); state.controlMode=m; },
    sendDriveCommand, updatePWM,
    toggleActuator: () => showToast('Actuador no definido en el protocolo del carrito','info'),
    sendAutonomousMission: () => showToast('Waypoint pendiente de soporte en el carrito','info')
  };

})();