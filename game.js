(function () {
  'use strict';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d', { alpha: false });
  var minimap = document.getElementById('minimap');
  var mctx = minimap.getContext('2d');
  var ui = {};
  [
    'menu','hud','pause','death','scoreboard','shop','result','red-score','blue-score','timer',
    'health-text','health-bar','armor-text','armor-bar','weapon-name','fire-mode','ammo','reserve',
    'reload-status','credits','kill-feed','hitmarker','damage-flash','hurt-direction','status-team',
    'respawn-count','killed-by','red-board','blue-board','scoreboard-time','shop-credits',
    'result-title','result-subtitle','final-red','final-blue','result-stats','toast','objective','hotbar','block-count'
  ].forEach(function (id) { ui[id] = document.getElementById(id); });

  var TAU = Math.PI * 2;
  var MAP_W = 28;
  var MAP_H = 20;
  var TARGET_SCORE = 30;
  var MATCH_TIME = 300;
  var FOV = Math.PI / 3;
  var RAY_STEP = 2;
  var PLAYER_RADIUS = 0.24;
  var map = [];
  var depthBuffer = [];
  var lastFrame = performance.now();
  var elapsed = 0;
  var gameTime = 0;
  var audio = null;
  var toastTimer = null;
  var hadPointerLock = false;

  var WEAPONS = [
    { name:'M1911', mode:'半自动', damage:29, rpm:310, mag:12, reserve:72, reload:1.25, spread:.011, pellets:1, color:'#c3cad2', kick:5 },
    { name:'MP40', mode:'自动', damage:16, rpm:670, mag:32, reserve:160, reload:1.75, spread:.036, pellets:1, color:'#8d969f', kick:4 },
    { name:'AK-47', mode:'自动', damage:24, rpm:510, mag:30, reserve:120, reload:1.9, spread:.025, pellets:1, color:'#9d693b', kick:7 },
    { name:'M16', mode:'自动', damage:21, rpm:730, mag:30, reserve:120, reload:1.8, spread:.016, pellets:1, color:'#7d8b76', kick:5 },
    { name:'双管霰弹枪', mode:'双发', damage:15, rpm:78, mag:2, reserve:30, reload:2.15, spread:.12, pellets:8, color:'#80542f', kick:13 },
    { name:'AWP', mode:'栓动', damage:108, rpm:44, mag:5, reserve:25, reload:2.7, spread:.0025, pellets:1, color:'#52784e', kick:16 }
  ];

  var DIFFICULTIES = [
    { name:'新兵', reaction:1.25, aim:.26, fire:1.35, speed:.72, vision:8, damage:.62, think:.55 },
    { name:'轻松', reaction:.86, aim:.18, fire:1.0, speed:.84, vision:10, damage:.78, think:.40 },
    { name:'标准', reaction:.55, aim:.11, fire:.75, speed:1.0, vision:13, damage:.95, think:.28 },
    { name:'老兵', reaction:.30, aim:.06, fire:.52, speed:1.14, vision:16, damage:1.07, think:.18 },
    { name:'精英', reaction:.14, aim:.027, fire:.34, speed:1.28, vision:20, damage:1.17, think:.10 }
  ];

  var TEAM = {
    red: { name:'赤焰队', color:'#ff4d59', dark:'#7d2630' },
    blue: { name:'苍穹队', color:'#35a7ff', dark:'#1e5883' }
  };

  var RED_NAMES = ['赤狐','熔岩','火花','绯刃','余烬'];
  var BLUE_NAMES = ['蓝鲸','霜影','电弧','海啸','极光'];
  var RED_SPAWNS = [[2.5,2.5],[2.5,6.5],[2.5,10],[2.5,13.5],[2.5,17.5]];
  var BLUE_SPAWNS = [[25.5,17.5],[25.5,13.5],[25.5,10],[25.5,6.5],[25.5,2.5]];

  var state = {
    mode:'menu',
    selectedTeam:'red',
    difficulty:2,
    selectedWeapon:2,
    scores:{red:0,blue:0},
    timeLeft:MATCH_TIME,
    bots:[],
    pickups:[],
    particles:[],
    tracers:[],
    keys:{},
    mouseDown:false,
    ads:false,
    shopOpen:false,
    scoreboardOpen:false,
    startedAt:0
  };

  var player = {
    id:'player', name:'你', team:'red', x:2.5, y:10.5, angle:0, alive:true,
    health:100, maxHealth:100, armor:0, kills:0, deaths:0, assists:0, streak:0,
    credits:0, weapon:2, ammo:[], reserve:[], lastShot:0, reloading:false,
    reloadEnd:0, recoil:0, bob:0, hitUntil:0, respawnAt:0, killedBy:'',
    vy:0, height:0, upgrades:{health:0,speed:0,armor:0}, lastDamager:null, slot:2, blocks:10
  };

  function createMap() {
    map = Array.from({length:MAP_H}, function (_, y) {
      return Array.from({length:MAP_W}, function (_, x) {
        return x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1 ? 1 : 0;
      });
    });
    function rect(x,y,w,h,v) {
      for (var yy=y; yy<y+h; yy++) for (var xx=x; xx<x+w; xx++) map[yy][xx]=v;
    }
    rect(3,3,2,3,3); rect(23,14,2,3,4);
    rect(3,14,2,3,3); rect(23,3,2,3,4);
    rect(7,2,1,5,2); rect(20,13,1,5,2);
    rect(7,13,1,5,2); rect(20,2,1,5,2);
    rect(10,3,5,1,1); rect(13,16,5,1,1);
    rect(13,6,5,1,5); rect(10,13,5,1,5);
    rect(11,8,2,1,5); rect(15,11,2,1,5);
    rect(15,8,2,1,5); rect(11,11,2,1,5);
    rect(13,9,2,2,2);
    rect(5,9,2,2,5); rect(21,9,2,2,5);
    rect(9,6,1,2,1); rect(18,12,1,2,1);
    rect(9,12,1,2,1); rect(18,6,1,2,1);
  }

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
  }

  function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
  function lerp(a,b,t){ return a+(b-a)*t; }
  function normAngle(a){ while(a>Math.PI)a-=TAU; while(a<-Math.PI)a+=TAU; return a; }
  function dist(a,b){ var dx=a.x-b.x,dy=a.y-b.y; return Math.sqrt(dx*dx+dy*dy); }
  function cellAt(x,y){ var ix=Math.floor(x),iy=Math.floor(y); return ix<0||iy<0||ix>=MAP_W||iy>=MAP_H?1:map[iy][ix]; }
  function isOpen(x,y,r) {
    r = r || PLAYER_RADIUS;
    return !cellAt(x-r,y-r) && !cellAt(x+r,y-r) && !cellAt(x-r,y+r) && !cellAt(x+r,y+r);
  }

  function castRay(px,py,angle,maxDist) {
    maxDist = maxDist || 35;
    var dx=Math.cos(angle),dy=Math.sin(angle);
    var mx=Math.floor(px),my=Math.floor(py);
    var ddx=Math.abs(1/(dx||.000001)),ddy=Math.abs(1/(dy||.000001));
    var sx,sy,sdx,sdy,side=0,d=0;
    if(dx<0){sx=-1;sdx=(px-mx)*ddx}else{sx=1;sdx=(mx+1-px)*ddx}
    if(dy<0){sy=-1;sdy=(py-my)*ddy}else{sy=1;sdy=(my+1-py)*ddy}
    var cell=0;
    while(d<maxDist){
      if(sdx<sdy){sdx+=ddx;mx+=sx;side=0;d=sdx-ddx}else{sdy+=ddy;my+=sy;side=1;d=sdy-ddy}
      if(mx<0||my<0||mx>=MAP_W||my>=MAP_H){cell=1;break}
      cell=map[my][mx]; if(cell)break;
    }
    var hitX=px+dx*d,hitY=py+dy*d;
    return {dist:Math.min(d,maxDist),cell:cell,side:side,hitX:hitX,hitY:hitY,mapX:mx,mapY:my};
  }

  function lineOfSight(a,b) {
    var ang=Math.atan2(b.y-a.y,b.x-a.x), d=dist(a,b);
    return castRay(a.x,a.y,ang,d+.05).dist >= d-.18;
  }

  function moveEntity(ent,dx,dy) {
    if(isOpen(ent.x+dx,ent.y,ent===player?PLAYER_RADIUS:.22)) ent.x+=dx;
    if(isOpen(ent.x,ent.y+dy,ent===player?PLAYER_RADIUS:.22)) ent.y+=dy;
  }

  function initAudio() {
    if(audio) return;
    var AC=window.AudioContext||window.webkitAudioContext;
    if(AC) audio=new AC();
  }

  function tone(freq,duration,type,vol,slide) {
    if(!audio) return;
    var o=audio.createOscillator(),g=audio.createGain(),t=audio.currentTime;
    o.type=type||'square';o.frequency.setValueAtTime(freq,t);
    if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(20,slide),t+duration);
    g.gain.setValueAtTime(vol||.03,t);g.gain.exponentialRampToValueAtTime(.0001,t+duration);
    o.connect(g);g.connect(audio.destination);o.start(t);o.stop(t+duration);
  }

  function gunSound(index) {
    var w=WEAPONS[index];
    tone(index===5?85:index===4?105:150,.07,'sawtooth',index===5?.12:.055,index===5?35:60);
    tone(index===0?520:250,.035,'square',.025,110);
    if(w.pellets>1)tone(62,.13,'sawtooth',.07,28);
  }
  function hitSound(kill){tone(kill?880:690,kill?.12:.055,'square',.03,kill?420:540)}

  function resetPlayerArsenal() {
    player.ammo=WEAPONS.map(function(w){return w.mag});
    player.reserve=WEAPONS.map(function(w){return w.reserve});
    player.weapon=state.selectedWeapon;
    player.slot=state.selectedWeapon;
    player.blocks=10;
    player.reloading=false;
  }

  function spawnPoint(team,index) {
    var arr=team==='red'?RED_SPAWNS:BLUE_SPAWNS;
    var p=arr[index%arr.length];
    return {x:p[0],y:p[1]};
  }

  function createBots() {
    state.bots=[];
    ['red','blue'].forEach(function(team){
      var names=team==='red'?RED_NAMES:BLUE_NAMES;
      for(var i=0;i<5;i++){
        if(team===player.team && i===0) continue;
        var p=spawnPoint(team,i);
        state.bots.push({
          id:team+'-'+i,name:names[i],team:team,x:p.x,y:p.y,angle:team==='red'?0:Math.PI,
          health:100,maxHealth:100,armor:0,alive:true,kills:0,deaths:0,assists:0,
          target:null,path:[],pathIndex:0,nextThink:0,nextPath:0,seenAt:0,lastShot:0,
          respawnAt:0,muzzleUntil:0,strafe:Math.random()<.5?-1:1,strafeUntil:0,
          weapon:1+Math.floor(Math.random()*4),lastDamager:null
        });
      }
    });
  }

  function startGame() {
    initAudio();
    if(audio && audio.state==='suspended') audio.resume();
    state.mode='playing';state.scores={red:0,blue:0};state.timeLeft=MATCH_TIME;
    state.pickups=[];state.particles=[];state.tracers=[];state.keys={};state.mouseDown=false;state.ads=false;
    player.team=state.selectedTeam;player.kills=0;player.deaths=0;player.assists=0;player.streak=0;player.credits=0;
    player.maxHealth=100;player.health=100;player.armor=0;player.alive=true;player.upgrades={health:0,speed:0,armor:0};
    var p=spawnPoint(player.team,0);player.x=p.x;player.y=p.y;player.angle=player.team==='red'?0:Math.PI;
    player.height=0;player.vy=0;player.lastDamager=null;player.slot=state.selectedWeapon;player.blocks=10;
    createMap();resetPlayerArsenal();createBots();
    ui.menu.classList.remove('active');ui.pause.classList.remove('active');ui.result.classList.remove('active');
    ui.death.classList.remove('active');ui.shop.classList.remove('active');ui.scoreboard.classList.remove('active');
    ui.hud.classList.add('active');ui.hud.setAttribute('aria-hidden','false');
    updateHUD();updateScoreboard();
    showToast(TEAM[player.team].name+'已部署 · 5V5 战斗开始');
    state.startedAt=performance.now();gameTime=0;
  }

  function returnMenu() {
    state.mode='menu';state.mouseDown=false;
    if(document.pointerLockElement)document.exitPointerLock();
    ['pause','death','shop','result','scoreboard'].forEach(function(k){ui[k].classList.remove('active')});
    ui.hud.classList.remove('active');ui.menu.classList.add('active');
  }

  function pauseGame() {
    if(state.mode!=='playing'||state.shopOpen||!player.alive)return;
    state.mode='paused';state.mouseDown=false;ui.pause.classList.add('active');
  }
  function resumeGame() {
    if(state.mode!=='paused')return;
    state.mode='playing';ui.pause.classList.remove('active');lastFrame=performance.now();canvas.requestPointerLock();
  }

  function endMatch() {
    if(state.mode==='ended')return;
    state.mode='ended';state.mouseDown=false;
    if(document.pointerLockElement)document.exitPointerLock();
    var win=state.scores[player.team] > state.scores[player.team==='red'?'blue':'red'];
    var draw=state.scores.red===state.scores.blue;
    ui['result-title'].textContent=draw?'平局':win?'胜利':'战败';
    ui['result-title'].style.color=draw?'#ffc861':win?'#54e09a':'#ff6570';
    var winner=state.scores.red>state.scores.blue?'赤焰队':state.scores.blue>state.scores.red?'苍穹队':'双方势均力敌';
    ui['result-subtitle'].textContent=draw?'双方未分胜负':winner+'控制了战场';
    ui['final-red'].textContent=state.scores.red;ui['final-blue'].textContent=state.scores.blue;
    ui['result-stats'].innerHTML='<span><b>'+player.kills+'</b><small>击杀</small></span><span><b>'+player.deaths+'</b><small>阵亡</small></span><span><b>'+Math.max(0,player.kills*100+player.assists*40)+'</b><small>战斗得分</small></span>';
    ui.result.classList.add('active');ui.scoreboard.classList.remove('active');ui.shop.classList.remove('active');
    tone(win?620:180,.5,'sawtooth',.05,win?980:80);
  }

  function respawn(ent,index) {
    var p=spawnPoint(ent.team,index==null?Math.floor(Math.random()*5):index);
    ent.x=p.x;ent.y=p.y;ent.angle=ent.team==='red'?0:Math.PI;ent.health=ent.maxHealth||100;ent.alive=true;ent.lastDamager=null;
    if(ent===player){
      player.armor=player.upgrades.armor*15;player.streak=0;player.height=0;player.vy=0;
      resetPlayerArsenal();ui.death.classList.remove('active');
      showToast('重新部署完成');
    }else{
      ent.armor=0;ent.target=null;ent.path=[];ent.weapon=1+Math.floor(Math.random()*5);
    }
  }

  function damageEntity(target,amount,attacker,sourceAngle) {
    if(!target.alive||attacker.team===target.team)return false;
    var absorbed=Math.min(target.armor||0,amount*.55);
    target.armor=(target.armor||0)-absorbed;amount-=absorbed;
    target.health-=amount;target.lastDamager=attacker;
    if(target===player){
      ui['damage-flash'].classList.add('flash');setTimeout(function(){ui['damage-flash'].classList.remove('flash')},55);
      var rel=normAngle((sourceAngle||0)-player.angle);
      ui['hurt-direction'].style.transform='translateX(-50%) rotate('+(rel*180/Math.PI+180)+'deg)';
      ui['hurt-direction'].classList.remove('show');void ui['hurt-direction'].offsetWidth;ui['hurt-direction'].classList.add('show');
      tone(95,.09,'sawtooth',.025,60);
    }
    if(target.health<=0){ killEntity(target,attacker);return true }
    return false;
  }

  function killEntity(victim,killer) {
    victim.health=0;victim.alive=false;victim.deaths++;victim.respawnAt=gameTime+3;
    if(killer&&killer!==victim){
      killer.kills++;state.scores[killer.team]++;
      if(killer===player){player.streak++;player.credits+=3;hitSound(true);showToast('击杀 '+victim.name+'  ·  +3 ◆')}
      if(victim===player){player.streak=0;player.killedBy=killer.name}
    }
    addKillFeed(killer||victim,victim);
    spawnBurst(victim.x,victim.y,TEAM[victim.team].color);
    if(victim===player){
      player.respawnAt=gameTime+3;ui['killed-by'].textContent='被 '+(killer?killer.name:'环境')+' 击倒';
      ui.death.classList.add('active');
    }
    if(state.scores.red>=TARGET_SCORE||state.scores.blue>=TARGET_SCORE)endMatch();
    updateHUD();
  }

  function addKillFeed(killer,victim) {
    var item=document.createElement('div');item.className='kill-item';
    item.innerHTML='<span class="'+killer.team+'">'+killer.name+'</span><b>◆</b><span class="'+victim.team+'">'+victim.name+'</span>';
    ui['kill-feed'].prepend(item);
    while(ui['kill-feed'].children.length>5)ui['kill-feed'].lastChild.remove();
    setTimeout(function(){if(item.parentNode)item.remove()},5000);
  }

  function spawnBurst(x,y,color) {
    for(var i=0;i<12;i++) state.particles.push({x:x,y:y,dx:(Math.random()-.5)*2,dy:(Math.random()-.5)*2,life:.7,color:color});
  }

  function startReload() {
    var w=WEAPONS[player.weapon];
    if(player.reloading||player.ammo[player.weapon]>=w.mag||player.reserve[player.weapon]<=0||!player.alive)return;
    player.reloading=true;player.reloadEnd=gameTime+w.reload;ui['reload-status'].textContent='正在换弹…';
    tone(310,.05,'square',.018,210);
  }
  function finishReload() {
    var w=WEAPONS[player.weapon],need=w.mag-player.ammo[player.weapon],take=Math.min(need,player.reserve[player.weapon]);
    player.ammo[player.weapon]+=take;player.reserve[player.weapon]-=take;player.reloading=false;
    tone(440,.05,'square',.02,520);
  }
  function switchWeapon(index) {
    if(index<0||index>7||index===player.slot)return;
    player.slot=index;player.reloading=false;player.recoil=0;state.ads=false;
    if(index<6){player.weapon=index;showToast('已切换 '+WEAPONS[index].name)}
    else showToast(index===6?'方块：左键放置临时掩体':'战术镐：左键破坏方块');
    tone(260,.04,'square',.015,340);updateHUD();
  }

  function attemptShoot() {
    if(state.mode!=='playing'||!player.alive||state.shopOpen)return;
    if(player.slot===6){placeBlock();return}
    if(player.slot===7){breakBlock();return}
    var w=WEAPONS[player.weapon],interval=60/w.rpm;
    if(gameTime-player.lastShot<interval||player.reloading)return;
    if(player.ammo[player.weapon]<=0){startReload();tone(90,.035,'square',.02,70);return}
    player.lastShot=gameTime;player.ammo[player.weapon]--;player.recoil=Math.min(20,player.recoil+w.kick);gunSound(player.weapon);
    var anyHit=false,killed=false;
    for(var pellet=0;pellet<w.pellets;pellet++){
      var spread=w.spread*(state.ads?.35:1);
      var shotAngle=player.angle+(Math.random()+Math.random()-1)*spread;
      var wall=castRay(player.x,player.y,shotAngle,32);
      var best=null,bestD=wall.dist;
      state.bots.forEach(function(bot){
        if(!bot.alive||bot.team===player.team)return;
        var d=dist(player,bot),a=Math.abs(normAngle(Math.atan2(bot.y-player.y,bot.x-player.x)-shotAngle));
        var body=Math.atan2(.28,d);
        if(d<bestD&&a<body&&lineOfSight(player,bot)){best=bot;bestD=d}
      });
      var endX=player.x+Math.cos(shotAngle)*bestD,endY=player.y+Math.sin(shotAngle)*bestD;
      state.tracers.push({x1:player.x,y1:player.y,x2:endX,y2:endY,life:.08,color:'#ffe7a0'});
      if(best){
        var centerDiff=Math.abs(normAngle(Math.atan2(best.y-player.y,best.x-player.x)-shotAngle));
        var head=centerDiff<Math.atan2(.08,bestD)&&w.pellets===1;
        killed=damageEntity(best,w.damage*(head?1.45:1),player,player.angle)||killed;anyHit=true;
      }
    }
    if(anyHit){
      ui.hitmarker.classList.add('show');setTimeout(function(){ui.hitmarker.classList.remove('show')},85);
      if(!killed)hitSound(false);
    }
    if(player.ammo[player.weapon]===0)setTimeout(startReload,220);
    updateHUD();
  }

  function placeBlock() {
    if(gameTime-player.lastShot<.34)return;
    player.lastShot=gameTime;
    if(player.blocks<=0){showToast('方块已用完');tone(80,.05,'square',.02,60);return}
    var tx=Math.floor(player.x+Math.cos(player.angle)*1.45);
    var ty=Math.floor(player.y+Math.sin(player.angle)*1.45);
    if(tx<=0||ty<=0||tx>=MAP_W-1||ty>=MAP_H-1||map[ty][tx]){showToast('这里无法放置');return}
    var occupied=allCombatants().some(function(e){return Math.floor(e.x)===tx&&Math.floor(e.y)===ty});
    if(occupied)return;
    map[ty][tx]=player.team==='red'?7:8;player.blocks--;tone(150,.07,'square',.03,85);
    showToast('已部署临时掩体');updateHUD();
  }

  function breakBlock() {
    if(gameTime-player.lastShot<.38)return;
    player.lastShot=gameTime;
    var hit=castRay(player.x,player.y,player.angle,2.35);
    if(hit.dist>2.2||[5,7,8].indexOf(hit.cell)<0){tone(95,.04,'square',.015,70);return}
    map[hit.mapY][hit.mapX]=0;
    if(hit.cell===(player.team==='red'?7:8))player.blocks=Math.min(10,player.blocks+1);
    spawnBurst(hit.hitX,hit.hitY,'#caa46f');tone(210,.09,'square',.025,110);updateHUD();
  }

  function findPath(sx,sy,tx,ty) {
    sx=Math.floor(sx);sy=Math.floor(sy);tx=Math.floor(tx);ty=Math.floor(ty);
    if(sx===tx&&sy===ty)return [];
    var q=[[sx,sy]],head=0,seen=new Int32Array(MAP_W*MAP_H);seen[sy*MAP_W+sx]=1;
    var parent=new Int32Array(MAP_W*MAP_H);parent.fill(-1);
    var dirs=[[1,0],[-1,0],[0,1],[0,-1]],found=-1;
    while(head<q.length&&head<480){
      var n=q[head++],idx=n[1]*MAP_W+n[0];
      for(var i=0;i<4;i++){
        var nx=n[0]+dirs[i][0],ny=n[1]+dirs[i][1],ni=ny*MAP_W+nx;
        if(nx<=0||ny<=0||nx>=MAP_W-1||ny>=MAP_H-1||map[ny][nx]||seen[ni])continue;
        seen[ni]=1;parent[ni]=idx;
        if(nx===tx&&ny===ty){found=ni;head=q.length;break}
        q.push([nx,ny]);
      }
    }
    if(found<0)return [];
    var out=[],cur=found,start=sy*MAP_W+sx;
    while(cur!==start&&cur>=0){out.push({x:cur%MAP_W+.5,y:Math.floor(cur/MAP_W)+.5});cur=parent[cur]}
    out.reverse();return out;
  }

  function allCombatants() {
    var list=state.bots.filter(function(b){return b.alive});
    if(player.alive)list.push(player);
    return list;
  }

  function chooseBotTarget(bot) {
    var best=null,bestScore=1e9;
    allCombatants().forEach(function(ent){
      if(ent.team===bot.team||ent===bot)return;
      var d=dist(bot,ent),score=d+(lineOfSight(bot,ent)?-5:0)+(ent===player?-0.2:0);
      if(score<bestScore){bestScore=score;best=ent}
    });
    if(best!==bot.target){bot.target=best;bot.seenAt=gameTime}
  }

  function botShoot(bot,target,difficulty) {
    if(gameTime-bot.lastShot<difficulty.fire)return;
    bot.lastShot=gameTime+Math.random()*.12;bot.muzzleUntil=gameTime+.07;
    var ang=Math.atan2(target.y-bot.y,target.x-bot.x),d=dist(bot,target);
    state.tracers.push({x1:bot.x,y1:bot.y,x2:target.x+(Math.random()-.5)*difficulty.aim*d,y2:target.y+(Math.random()-.5)*difficulty.aim*d,life:.1,color:TEAM[bot.team].color});
    var hitChance=clamp(1-difficulty.aim*1.7-d*.018,.12,.94);
    if(Math.random()<hitChance){
      var base=bot.weapon===5?54:bot.weapon===4?28:11+bot.weapon*2.5;
      damageEntity(target,base*difficulty.damage,bot,ang);
    }
    if(d<8)tone(120+bot.weapon*20,.035,'sawtooth',.006,70);
  }

  function updateBot(bot,dt,index) {
    if(!bot.alive){if(gameTime>=bot.respawnAt)respawn(bot,index+1);return}
    var difficulty=DIFFICULTIES[state.difficulty];
    if(gameTime>=bot.nextThink){chooseBotTarget(bot);bot.nextThink=gameTime+difficulty.think+Math.random()*.1}
    var target=bot.target;if(!target||!target.alive)return;
    var d=dist(bot,target),visible=d<difficulty.vision&&lineOfSight(bot,target);
    var desired=Math.atan2(target.y-bot.y,target.x-bot.x);
    var turn=normAngle(desired-bot.angle);
    bot.angle+=clamp(turn,-dt*(2.4+state.difficulty),dt*(2.4+state.difficulty));
    var mx=0,my=0;
    if(visible){
      if(gameTime-bot.seenAt>=difficulty.reaction&&Math.abs(turn)<.45)botShoot(bot,target,difficulty);
      if(gameTime>bot.strafeUntil){bot.strafe=Math.random()<.5?-1:1;bot.strafeUntil=gameTime+1+Math.random()*1.3}
      var forward=d>5.5?1:d<2.6?-1:0;
      mx=Math.cos(desired)*forward+Math.cos(desired+Math.PI/2)*bot.strafe*.42;
      my=Math.sin(desired)*forward+Math.sin(desired+Math.PI/2)*bot.strafe*.42;
    }else{
      if(gameTime>=bot.nextPath){
        bot.path=findPath(bot.x,bot.y,target.x,target.y);bot.pathIndex=0;bot.nextPath=gameTime+.75+Math.random()*.35;
      }
      var node=bot.path[bot.pathIndex];
      if(node){
        if(Math.hypot(node.x-bot.x,node.y-bot.y)<.25){bot.pathIndex++;node=bot.path[bot.pathIndex]}
        if(node){var a=Math.atan2(node.y-bot.y,node.x-bot.x);mx=Math.cos(a);my=Math.sin(a);bot.angle=a}
      }
    }
    var speed=1.75*difficulty.speed*dt;
    moveEntity(bot,mx*speed,my*speed);
    state.bots.forEach(function(other){
      if(other!==bot&&other.alive&&dist(bot,other)<.38){
        var a=Math.atan2(bot.y-other.y,bot.x-other.x);moveEntity(bot,Math.cos(a)*dt*.4,Math.sin(a)*dt*.4);
      }
    });
  }

  function updatePlayer(dt) {
    if(!player.alive){
      ui['respawn-count'].textContent=Math.max(0,player.respawnAt-gameTime).toFixed(1);
      if(gameTime>=player.respawnAt)respawn(player,0);
      return;
    }
    if(player.reloading&&gameTime>=player.reloadEnd)finishReload();
    var forward=(state.keys.KeyW?1:0)-(state.keys.KeyS?1:0);
    var side=(state.keys.KeyD?1:0)-(state.keys.KeyA?1:0);
    var len=Math.hypot(forward,side)||1;forward/=len;side/=len;
    var moving=Math.abs(forward)+Math.abs(side)>0;
    var speed=(state.keys.ShiftLeft||state.keys.ShiftRight?3.65:2.7)*(1+player.upgrades.speed*.08)*dt;
    var dx=(Math.cos(player.angle)*forward+Math.cos(player.angle+Math.PI/2)*side)*speed;
    var dy=(Math.sin(player.angle)*forward+Math.sin(player.angle+Math.PI/2)*side)*speed;
    moveEntity(player,dx,dy);
    if(moving)player.bob+=dt*(state.keys.ShiftLeft?12:9);
    player.recoil=lerp(player.recoil,0,clamp(dt*10,0,1));
    if(player.height>0||player.vy>0){player.vy-=10*dt;player.height+=player.vy*dt;if(player.height<=0){player.height=0;player.vy=0}}
    if(state.mouseDown)attemptShoot();
  }

  function updateEffects(dt) {
    state.particles.forEach(function(p){p.x+=p.dx*dt;p.y+=p.dy*dt;p.life-=dt});
    state.particles=state.particles.filter(function(p){return p.life>0});
    state.tracers.forEach(function(t){t.life-=dt});
    state.tracers=state.tracers.filter(function(t){return t.life>0});
  }

  function update(dt) {
    if(state.mode!=='playing')return;
    gameTime+=dt;state.timeLeft=Math.max(0,MATCH_TIME-gameTime);
    updatePlayer(dt);
    state.bots.forEach(function(bot,i){updateBot(bot,dt,i)});
    updateEffects(dt);
    if(state.timeLeft<=0)endMatch();
    updateHUD();
  }

  function wallColor(cell,side,distance,tex) {
    var base=cell===2?[92,108,121]:cell===3?[139,49,56]:cell===4?[38,91,137]:cell===5?[135,96,48]:cell===7?[184,54,64]:cell===8?[43,133,198]:[103,112,122];
    var stripe=tex>.82||tex<.06?1.18:tex>.42&&tex<.48?.78:1;
    var shade=clamp((1-distance/35)*(side?.78:1)*stripe,.22,1.12);
    return 'rgb('+Math.floor(base[0]*shade)+','+Math.floor(base[1]*shade)+','+Math.floor(base[2]*shade)+')';
  }

  function renderWorld() {
    var w=canvas.width,h=canvas.height,horizon=h*.48+player.recoil*1.2-player.height*h*.09;
    var sky=ctx.createLinearGradient(0,0,0,horizon);sky.addColorStop(0,'#6c91b1');sky.addColorStop(1,'#b7c1bd');
    ctx.fillStyle=sky;ctx.fillRect(0,0,w,horizon);
    ctx.fillStyle='#222733';ctx.fillRect(0,horizon,w,h-horizon);
    var floor=ctx.createLinearGradient(0,horizon,0,h);floor.addColorStop(0,'rgba(89,91,87,.9)');floor.addColorStop(1,'#161a21');
    ctx.fillStyle=floor;ctx.fillRect(0,horizon,w,h-horizon);
    ctx.globalAlpha=.16;ctx.strokeStyle='#d5d2bd';ctx.lineWidth=1;
    for(var gy=1;gy<12;gy++){var yy=horizon+(h-horizon)*(1-1/(1+gy*.34));ctx.beginPath();ctx.moveTo(0,yy);ctx.lineTo(w,yy);ctx.stroke()}
    ctx.globalAlpha=1;

    var fov=state.ads?(player.weapon===5?.30:FOV*.72):FOV;
    var rays=Math.ceil(w/RAY_STEP);depthBuffer.length=rays;
    for(var i=0;i<rays;i++){
      var cam=i/rays-.5,ang=player.angle+cam*fov,hit=castRay(player.x,player.y,ang,36);
      var corrected=hit.dist*Math.cos(ang-player.angle),wallH=Math.min(h*2,h/(corrected+.001)*.86);
      var top=horizon-wallH/2,tex=hit.side?hit.hitX%1:hit.hitY%1;
      ctx.fillStyle=wallColor(hit.cell,hit.side,corrected,tex);ctx.fillRect(i*RAY_STEP,top,RAY_STEP+1,wallH);
      if(tex<.035){ctx.fillStyle='rgba(255,255,255,.09)';ctx.fillRect(i*RAY_STEP,top,1,wallH)}
      if(wallH<h*1.8){ctx.fillStyle='rgba(0,0,0,.16)';ctx.fillRect(i*RAY_STEP,top+wallH-3,RAY_STEP+1,3)}
      depthBuffer[i]=corrected;
    }
    renderWorldEntities(fov,horizon);
    renderWeapon();
  }

  function projectPoint(x,y,fov) {
    var dx=x-player.x,dy=y-player.y,d=Math.hypot(dx,dy),a=normAngle(Math.atan2(dy,dx)-player.angle);
    return {d:d,a:a,x:(.5+a/fov)*canvas.width};
  }

  function renderWorldEntities(fov,horizon) {
    var entities=state.bots.filter(function(b){return b.alive}).map(function(b){return {type:'bot',obj:b,p:projectPoint(b.x,b.y,fov)}});
    state.particles.forEach(function(p){entities.push({type:'particle',obj:p,p:projectPoint(p.x,p.y,fov)})});
    entities.sort(function(a,b){return b.p.d-a.p.d});
    entities.forEach(function(e){
      if(Math.abs(e.p.a)>fov*.62||e.p.d<.2)return;
      var ri=clamp(Math.floor(e.p.x/RAY_STEP),0,depthBuffer.length-1);
      if(depthBuffer[ri]<e.p.d-.25)return;
      if(e.type==='bot')drawBot(e.obj,e.p,horizon);else drawParticle(e.obj,e.p,horizon);
    });
    renderTracers(fov,horizon);
  }

  function drawBot(bot,p,horizon) {
    var scale=canvas.height/(p.d+.001)*.72;
    var bh=clamp(scale,12,canvas.height*1.8),bw=bh*.38;
    var bottom=horizon+canvas.height/(p.d+.001)*.43;
    var x=p.x-bw/2,y=bottom-bh,color=TEAM[bot.team].color,dark=TEAM[bot.team].dark;
    ctx.fillStyle='rgba(0,0,0,.25)';ctx.fillRect(x-bw*.12,bottom+2,bw*1.24,Math.max(2,bh*.035));
    ctx.fillStyle=dark;ctx.fillRect(x+bw*.08,y+bh*.62,bw*.34,bh*.37);ctx.fillRect(x+bw*.58,y+bh*.62,bw*.34,bh*.37);
    ctx.fillStyle=color;ctx.fillRect(x,y+bh*.28,bw,bh*.40);
    ctx.fillStyle=dark;ctx.fillRect(x-bw*.22,y+bh*.31,bw*.22,bh*.34);ctx.fillRect(x+bw,y+bh*.31,bw*.22,bh*.34);
    ctx.fillStyle='#d5a579';ctx.fillRect(x+bw*.14,y,bw*.72,bh*.27);
    ctx.fillStyle='#2a2020';ctx.fillRect(x+bw*.14,y,bw*.72,bh*.07);
    ctx.fillStyle='#151c25';ctx.fillRect(x+bw*.22,y+bh*.1,bw*.13,bh*.035);ctx.fillRect(x+bw*.65,y+bh*.1,bw*.13,bh*.035);
    ctx.fillStyle='#222';ctx.fillRect(x+bw*.56,y+bh*.43,bw*.75,Math.max(2,bh*.07));
    if(bot.muzzleUntil>gameTime){ctx.fillStyle='#fff2a0';ctx.fillRect(x+bw*1.28,y+bh*.4,bw*.24,bh*.13)}
    if(p.d<14){
      var labelY=y-Math.max(12,bh*.06),barW=Math.max(30,bw*1.2);
      ctx.fillStyle='rgba(0,0,0,.65)';ctx.fillRect(p.x-barW/2,labelY,barW,4);
      ctx.fillStyle=color;ctx.fillRect(p.x-barW/2,labelY,barW*clamp(bot.health/bot.maxHealth,0,1),4);
      ctx.fillStyle=bot.team===player.team?'#b9e1ff':'#ffd0d3';ctx.font=Math.max(8,Math.min(13,bh*.075))+'px sans-serif';ctx.textAlign='center';
      ctx.fillText(bot.name+(bot.team===player.team?'  ◆':''),p.x,labelY-3);ctx.textAlign='left';
    }
  }

  function drawParticle(p,proj,horizon) {
    var s=clamp(canvas.height/(proj.d+1)*.018,1,8),y=horizon+canvas.height/(proj.d+.001)*.25;
    ctx.globalAlpha=clamp(p.life,0,1);ctx.fillStyle=p.color;ctx.fillRect(proj.x-s/2,y-s/2,s,s);ctx.globalAlpha=1;
  }

  function renderTracers(fov,horizon) {
    ctx.lineWidth=Math.max(1,canvas.width/900);ctx.globalCompositeOperation='lighter';
    state.tracers.forEach(function(t){
      var a=projectPoint(t.x1,t.y1,fov),b=projectPoint(t.x2,t.y2,fov);
      if(Math.abs(a.a)>fov*.8&&Math.abs(b.a)>fov*.8)return;
      var ay=horizon+canvas.height/(a.d+.25)*.05,by=horizon+canvas.height/(b.d+.25)*.05;
      ctx.globalAlpha=clamp(t.life*10,0,1);ctx.strokeStyle=t.color;ctx.beginPath();ctx.moveTo(a.x,ay);ctx.lineTo(b.x,by);ctx.stroke();
    });
    ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;
  }

  function renderWeapon() {
    if(!player.alive)return;
    var w=canvas.width,h=canvas.height,weapon=WEAPONS[player.weapon];
    var bobX=Math.sin(player.bob)*8*(state.keys.KeyW||state.keys.KeyS||state.keys.KeyA||state.keys.KeyD?1:0);
    var bobY=Math.abs(Math.cos(player.bob))*5,rec=player.recoil*2.4;
    ctx.save();ctx.translate(w*.66+bobX,h*.82+bobY+rec);ctx.rotate(-.04-player.recoil*.003);
    var s=Math.max(1,w/1100);
    ctx.fillStyle=TEAM[player.team].dark;ctx.fillRect(-20*s,20*s,78*s,62*s);
    ctx.fillStyle='#c69268';ctx.fillRect(25*s,8*s,55*s,42*s);
    ctx.fillStyle=weapon.color;
    if(player.slot===6){ctx.fillStyle=player.team==='red'?'#b63844':'#2b86c6';ctx.fillRect(-85*s,-70*s,160*s,145*s);ctx.fillStyle='#ffffff20';ctx.fillRect(-70*s,-55*s,58*s,58*s)}
    else if(player.slot===7){ctx.fillStyle='#697683';ctx.fillRect(-180*s,-40*s,270*s,35*s);ctx.fillRect(-180*s,-40*s,38*s,150*s);ctx.fillStyle='#5b3b2b';ctx.fillRect(55*s,-5*s,35*s,150*s)}
    else if(player.weapon===0){ctx.fillRect(-20*s,-20*s,155*s,40*s);ctx.fillRect(25*s,18*s,42*s,80*s)}
    else if(player.weapon===4){ctx.fillRect(-155*s,-22*s,300*s,30*s);ctx.fillStyle='#30251d';ctx.fillRect(-155*s,12*s,210*s,22*s);ctx.fillStyle=weapon.color;ctx.fillRect(45*s,8*s,62*s,78*s)}
    else if(player.weapon===5){ctx.fillRect(-210*s,-21*s,390*s,34*s);ctx.fillStyle='#1a211a';ctx.fillRect(-50*s,-54*s,90*s,45*s);ctx.fillRect(-14*s,12*s,53*s,90*s)}
    else{ctx.fillRect(-180*s,-25*s,340*s,43*s);ctx.fillStyle='#23282a';ctx.fillRect(-85*s,-37*s,155*s,14*s);ctx.fillStyle=weapon.color;ctx.fillRect(0,14*s,55*s,95*s)}
    ctx.fillStyle='#171a1e';ctx.fillRect(-180*s,-29*s,62*s,9*s);
    if(player.slot<6&&gameTime-player.lastShot<.055){ctx.fillStyle='#fff7b2';ctx.fillRect(-230*s,-42*s,55*s,38*s);ctx.fillStyle='#ffad32';ctx.fillRect(-250*s,-31*s,70*s,16*s)}
    ctx.restore();
    if(state.ads&&player.weapon===5){
      ctx.save();ctx.fillStyle='rgba(0,0,0,.92)';ctx.beginPath();ctx.rect(0,0,w,h);ctx.arc(w/2,h/2,Math.min(w,h)*.42,0,TAU,true);ctx.fill();
      ctx.strokeStyle='#111';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(w/2,0);ctx.lineTo(w/2,h);ctx.moveTo(0,h/2);ctx.lineTo(w,h/2);ctx.stroke();ctx.restore();
    }
  }

  function renderMenuBackdrop() {
    var w=canvas.width,h=canvas.height;
    var g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,'#151e33');g.addColorStop(.55,'#080c17');g.addColorStop(1,'#20131b');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
    ctx.globalAlpha=.25;
    for(var i=0;i<60;i++){var s=20+(i%7)*8,x=(i*197)%w,y=(i*83)%h;ctx.fillStyle=i%3===0?'#ff4d59':i%3===1?'#35a7ff':'#8793a5';ctx.fillRect(x,y,s,s)}
    ctx.globalAlpha=1;
  }

  function renderMinimap() {
    var w=minimap.width,h=minimap.height,s=Math.min(w/MAP_W,h/MAP_H),ox=(w-MAP_W*s)/2,oy=(h-MAP_H*s)/2;
    mctx.fillStyle='#0a0f18';mctx.fillRect(0,0,w,h);
    for(var y=0;y<MAP_H;y++)for(var x=0;x<MAP_W;x++)if(map[y][x]){
      var c=map[y][x];mctx.fillStyle=c===3?'#5b252b':c===4?'#1f4868':c===5?'#5a472e':'#3b4350';mctx.fillRect(ox+x*s,oy+y*s,s-1,s-1);
    }
    state.bots.forEach(function(b){if(!b.alive)return;mctx.fillStyle=TEAM[b.team].color;mctx.beginPath();mctx.arc(ox+b.x*s,oy+b.y*s,2.2,0,TAU);mctx.fill()});
    if(player.alive){mctx.save();mctx.translate(ox+player.x*s,oy+player.y*s);mctx.rotate(player.angle);mctx.fillStyle='#fff';mctx.beginPath();mctx.moveTo(6,0);mctx.lineTo(-4,-4);mctx.lineTo(-4,4);mctx.closePath();mctx.fill();mctx.restore()}
  }

  function fmtTime(sec) {
    sec=Math.ceil(Math.max(0,sec));var m=Math.floor(sec/60),s=sec%60;return m+':'+String(s).padStart(2,'0');
  }

  function updateHUD() {
    ui['red-score'].textContent=state.scores.red;ui['blue-score'].textContent=state.scores.blue;
    var time=fmtTime(state.timeLeft);ui.timer.textContent=time;ui['scoreboard-time'].textContent=time;
    ui['health-text'].textContent=Math.max(0,Math.ceil(player.health));ui['health-bar'].style.width=clamp(player.health/player.maxHealth*100,0,100)+'%';
    ui['armor-text'].textContent=Math.ceil(player.armor);ui['armor-bar'].style.width=clamp(player.armor/45*100,0,100)+'%';
    var w=WEAPONS[player.weapon];
    ui['weapon-name'].textContent=player.slot===6?'方块':player.slot===7?'战术镐':w.name;
    ui['fire-mode'].textContent=player.slot===6?'建造':player.slot===7?'破坏':w.mode;
    ui.ammo.textContent=player.slot===6?player.blocks:player.slot===7?'∞':(player.ammo[player.weapon]||0);
    ui.reserve.textContent=player.slot>=6?'':(player.reserve[player.weapon]||0);
    ui['reload-status'].textContent=player.reloading?'正在换弹 '+Math.max(0,player.reloadEnd-gameTime).toFixed(1)+'s':'';
    ui.credits.textContent=player.credits;ui['shop-credits'].textContent=player.credits;
    ui['status-team'].textContent=player.team==='red'?'R':'B';ui['status-team'].style.background=TEAM[player.team].color;
    ui['block-count'].textContent=player.blocks;
    ui.hotbar.querySelectorAll('span').forEach(function(s){s.classList.toggle('selected',+s.dataset.slot===player.slot)});
    renderMinimap();
  }

  function updateScoreboard() {
    ['red','blue'].forEach(function(team){
      var members=state.bots.filter(function(b){return b.team===team});
      if(player.team===team)members.push(player);
      members.sort(function(a,b){return b.kills-a.kills});
      var html='<div class="board-title"><b>'+TEAM[team].name+' · '+members.length+'/5</b><span>击杀</span><span>阵亡</span><span>延迟</span></div>';
      members.forEach(function(m){
        html+='<div class="board-row '+(m===player?'me':'')+'"><b><i></i>'+m.name+(m===player?'（你）':' [BOT]')+'</b><span>'+m.kills+'</span><span>'+m.deaths+'</span><span>0</span></div>';
      });
      ui[team+'-board'].innerHTML=html;
    });
  }

  function showToast(text) {
    ui.toast.textContent=text;ui.toast.classList.add('show');clearTimeout(toastTimer);
    toastTimer=setTimeout(function(){ui.toast.classList.remove('show')},1800);
  }

  function openShop() {
    if(state.mode!=='playing'||!player.alive)return;
    state.shopOpen=true;state.mouseDown=false;ui.shop.classList.add('active');
    if(document.pointerLockElement)document.exitPointerLock();refreshShop();
  }
  function closeShop() {
    if(!state.shopOpen)return;state.shopOpen=false;ui.shop.classList.remove('active');lastFrame=performance.now();canvas.requestPointerLock();
  }
  function refreshShop() {
    document.querySelectorAll('.shop-options button').forEach(function(btn){
      var type=btn.dataset.upgrade,level=player.upgrades[type],cost=3+level*2;
      btn.querySelector('em b').textContent=level>=3?'—':cost;btn.querySelector('u').textContent='等级 '+level+'/3';
      btn.classList.toggle('maxed',level>=3);btn.disabled=level>=3;
    });
    ui['shop-credits'].textContent=player.credits;
  }
  function buyUpgrade(type) {
    var level=player.upgrades[type],cost=3+level*2;
    if(level>=3)return;if(player.credits<cost){showToast('强化币不足');tone(90,.12,'square',.02,55);return}
    player.credits-=cost;player.upgrades[type]++;
    if(type==='health'){player.maxHealth+=20;player.health+=20}
    if(type==='armor')player.armor+=15;
    refreshShop();updateHUD();showToast('强化成功 · '+(level+1)+' 级');tone(440,.18,'square',.03,820);
  }

  function loop(now) {
    var dt=Math.min(.05,(now-lastFrame)/1000);lastFrame=now;elapsed+=dt;
    if(state.mode==='playing'&&!state.shopOpen)update(dt);
    if(state.mode==='menu')renderMenuBackdrop();else renderWorld();
    if(state.mode==='playing'&&Math.floor(gameTime*4)%2===0)updateScoreboard();
    requestAnimationFrame(loop);
  }

  document.querySelectorAll('.team-card').forEach(function(btn){
    btn.addEventListener('click',function(){
      state.selectedTeam=btn.dataset.team;
      document.querySelectorAll('.team-card').forEach(function(b){var on=b===btn;b.classList.toggle('selected',on);b.setAttribute('aria-checked',on)});
    });
  });
  document.querySelectorAll('#difficulty-list button').forEach(function(btn){
    btn.addEventListener('click',function(){
      state.difficulty=+btn.dataset.difficulty;
      document.querySelectorAll('#difficulty-list button').forEach(function(b){var on=b===btn;b.classList.toggle('selected',on);b.setAttribute('aria-checked',on)});
      document.getElementById('difficulty-bar').style.width=((state.difficulty+1)*20)+'%';
      document.getElementById('difficulty-label').textContent=DIFFICULTIES[state.difficulty].name;
    });
  });
  document.querySelectorAll('#weapon-list button').forEach(function(btn){
    btn.addEventListener('click',function(){
      state.selectedWeapon=+btn.dataset.weapon;
      document.querySelectorAll('#weapon-list button').forEach(function(b){b.classList.toggle('selected',b===btn)});
    });
  });
  document.getElementById('start-btn').addEventListener('click',startGame);
  document.getElementById('resume-btn').addEventListener('click',resumeGame);
  document.getElementById('restart-btn').addEventListener('click',startGame);
  document.getElementById('menu-btn').addEventListener('click',returnMenu);
  document.getElementById('play-again-btn').addEventListener('click',startGame);
  document.getElementById('result-menu-btn').addEventListener('click',returnMenu);
  document.getElementById('shop-close').addEventListener('click',closeShop);
  document.querySelectorAll('.shop-options button').forEach(function(btn){btn.addEventListener('click',function(){buyUpgrade(btn.dataset.upgrade)})});

  window.addEventListener('resize',resize);
  document.addEventListener('keydown',function(e){
    state.keys[e.code]=true;
    if(e.code==='Tab'){
      e.preventDefault();
      if(state.mode==='playing'){state.scoreboardOpen=true;ui.scoreboard.classList.add('active');updateScoreboard()}
    }
    if(e.code==='KeyR')startReload();
    if(e.code==='KeyB'){if(state.shopOpen)closeShop();else openShop()}
    if(e.code==='Space'&&state.mode==='playing'&&player.alive&&player.height===0){player.vy=4.2;tone(120,.04,'square',.01,90)}
    if(e.code.indexOf('Digit')===0){var n=+e.code.slice(5)-1;if(n>=0&&n<8)switchWeapon(n)}
    if(e.code==='KeyG'&&state.mode==='playing'){state.scoreboardOpen=!state.scoreboardOpen;ui.scoreboard.classList.toggle('active',state.scoreboardOpen);updateScoreboard()}
  });
  document.addEventListener('keyup',function(e){
    state.keys[e.code]=false;
    if(e.code==='Tab'){state.scoreboardOpen=false;ui.scoreboard.classList.remove('active')}
  });
  canvas.addEventListener('mousedown',function(e){
    if(state.mode==='playing'&&!state.shopOpen){
      if(e.button===0){state.mouseDown=true;attemptShoot()}
      if(e.button===2)state.ads=!state.ads;
    }
  });
  canvas.addEventListener('dblclick',function(){
    if(state.mode!=='playing'||state.shopOpen)return;
    try {
      var lockRequest=canvas.requestPointerLock();
      if(lockRequest&&lockRequest.catch)lockRequest.catch(function(){});
    } catch(ignore) {}
  });
  document.addEventListener('mouseup',function(e){if(e.button===0)state.mouseDown=false});
  document.addEventListener('mousemove',function(e){
    if(state.mode==='playing'&&!state.shopOpen&&(document.pointerLockElement===canvas||e.target===canvas)){
      player.angle=normAngle(player.angle+e.movementX*.00225);
    }
  });
  canvas.addEventListener('contextmenu',function(e){e.preventDefault()});
  document.addEventListener('pointerlockchange',function(){
    if(document.pointerLockElement===canvas){hadPointerLock=true;return}
    if(hadPointerLock&&state.mode==='playing'&&!state.shopOpen&&!state.scoreboardOpen&&player.alive){hadPointerLock=false;pauseGame()}
  });
  document.addEventListener('visibilitychange',function(){if(document.hidden&&state.mode==='playing')pauseGame()});

  window.__voxelTDM = {
    getState:function(){
      return {
        mode:state.mode,team:player.team,difficulty:DIFFICULTIES[state.difficulty].name,
        score:{red:state.scores.red,blue:state.scores.blue},timeLeft:state.timeLeft,
        player:{alive:player.alive,health:player.health,armor:player.armor,kills:player.kills,deaths:player.deaths,weapon:player.slot<6?WEAPONS[player.weapon].name:player.slot===6?'方块':'战术镐',credits:player.credits,blocks:player.blocks},
        teams:{red:state.bots.filter(function(b){return b.team==='red'}).length+(player.team==='red'?1:0),blue:state.bots.filter(function(b){return b.team==='blue'}).length+(player.team==='blue'?1:0)},
        bots:state.bots.length
      };
    }
  };

  createMap();resize();resetPlayerArsenal();requestAnimationFrame(loop);
})();
