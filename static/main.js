const SVG_NS = "http://www.w3.org/2000/svg";
const board = document.getElementById('game-board');
const statusBox = document.getElementById('status-box');
const lastMoveInfo = document.getElementById('last-move-info');
const scoresTableBody = document.querySelector('#scores-table tbody');
const colorSelector = document.getElementById('color-selector');
const followColorSelector = document.getElementById('follow-color-selector');
const resetButton = document.getElementById('reset-button');
// 【新功能】 获取悔棋按钮的引用
const undoButton = document.getElementById('undo-button');

const POINT_RADIUS_RATIO = 0.2;
const TOUCH_RADIUS_RATIO = 0.6;

let gameState = {};
let myColor = null;
let followColor = null;
let selectedPoints = [], isFetching = false;

let turnTimerInterval = null;
let turnStartTime = null;

function axialToSvg(q, r) { return { x: 1.5 * q, y: Math.sqrt(3) / 2 * q + Math.sqrt(3) * r }; }
function getBoardBounds() { 
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    if (gameState.points) { gameState.points.forEach(p => { const { x, y } = axialToSvg(p[0], p[1]); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }); }
    const padding = 2; return { x: minX - padding, y: minY - padding, width: (maxX - minX) + 2 * padding, height: (maxY - minY) + 2 * padding, };
}
function drawBoard() { 
    if (!gameState.points) return; board.innerHTML = ''; const bounds = getBoardBounds(); board.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
    gameState.captured_triangles.forEach(tri => { const polygon = document.createElementNS(SVG_NS, 'polygon'); const p1 = axialToSvg(tri.points[0][0], tri.points[0][1]); const p2 = axialToSvg(tri.points[1][0], tri.points[1][1]); const p3 = axialToSvg(tri.points[2][0], tri.points[2][1]); polygon.setAttribute('points', `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`); polygon.setAttribute('fill', tri.color); polygon.setAttribute('opacity', '0.6'); board.appendChild(polygon); });
    gameState.lines.forEach(line => { for (let i = 0; i < line.points.length - 1; i++) { const p_start = axialToSvg(line.points[i][0], line.points[i][1]); const p_end = axialToSvg(line.points[i+1][0], line.points[i+1][1]); const svgLine = document.createElementNS(SVG_NS, 'line'); svgLine.setAttribute('x1', p_start.x); svgLine.setAttribute('y1', p_start.y); svgLine.setAttribute('x2', p_end.x); svgLine.setAttribute('y2', p_end.y); svgLine.setAttribute('stroke', line.color); svgLine.setAttribute('stroke-width', 0.2); svgLine.setAttribute('stroke-linecap', 'round'); board.appendChild(svgLine); } });
    gameState.points.forEach(p => { const { x, y } = axialToSvg(p[0], p[1]); const q = p[0], r = p[1]; const circle = document.createElementNS(SVG_NS, 'circle'); circle.setAttribute('cx', x); circle.setAttribute('cy', y); circle.setAttribute('r', POINT_RADIUS_RATIO); circle.setAttribute('fill', '#333'); circle.classList.add('game-point'); circle.dataset.q = q; circle.dataset.r = r; const touchTarget = document.createElementNS(SVG_NS, 'circle'); touchTarget.setAttribute('cx', x); touchTarget.setAttribute('cy', y); touchTarget.setAttribute('r', TOUCH_RADIUS_RATIO); touchTarget.setAttribute('fill', 'transparent'); touchTarget.style.cursor = 'pointer'; touchTarget.addEventListener('click', () => onPointClick({target: circle})); board.appendChild(circle); board.appendChild(touchTarget); });
}

function isMyTurn() {
    if (!myColor || !followColor) return false;
    const lastMoveColor = gameState.last_move_color;
    if (lastMoveColor === null) return true;
    if (lastMoveColor === followColor) return true;
    return false;
}

function startTurnTimer() {
    if (turnTimerInterval) clearInterval(turnTimerInterval);
    turnStartTime = Date.now();
    statusBox.textContent = '00:00';
    turnTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - turnStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        statusBox.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }, 1000);
}

function stopTurnTimer() {
    clearInterval(turnTimerInterval);
    turnTimerInterval = null;
    turnStartTime = null;
}

function updateUI() {
    if (!gameState.players) return;

    if (colorSelector.children.length === 0) {
        gameState.players.forEach(color => {
            const btn = document.createElement('button'); btn.className = 'color-btn'; btn.style.backgroundColor = color; btn.dataset.color = color;
            btn.addEventListener('click', () => selectMyColor(color));
            colorSelector.appendChild(btn);
        });
    }
    document.querySelectorAll('#color-selector .color-btn').forEach(btn => btn.classList.toggle('selected', btn.dataset.color === myColor));

    if (followColorSelector.children.length === 0) {
        gameState.players.forEach(color => {
            const btn = document.createElement('button'); btn.className = 'color-btn'; btn.style.backgroundColor = color; btn.dataset.color = color;
            btn.addEventListener('click', () => selectFollowColor(color));
            followColorSelector.appendChild(btn);
        });
    }
    document.querySelectorAll('#follow-color-selector .color-btn').forEach(btn => btn.classList.toggle('selected', btn.dataset.color === followColor));
    
    const myTurnNow = isMyTurn();
    const boardContainer = document.getElementById('game-board-container');
    if (myTurnNow) {
        board.classList.remove('disabled');
        boardContainer.classList.add('active');
        boardContainer.style.borderColor = myColor || '#428bca';
        statusBox.style.backgroundColor = myColor;
        statusBox.style.color = 'white';
        if (!turnTimerInterval) {
            startTurnTimer();
        }
    } else {
        board.classList.add('disabled');
        boardContainer.classList.remove('active');
        boardContainer.style.borderColor = '#ccc';
        if (turnTimerInterval) {
            stopTurnTimer();
        }
        if (!myColor || !followColor) {
            statusBox.textContent = '请选择你的颜色和跟随的颜色';
            statusBox.style.backgroundColor = '#eee';
            statusBox.style.color = 'black';
        } else {
            statusBox.textContent = `等待跟随的颜色操作...`;
            statusBox.style.backgroundColor = followColor;
            statusBox.style.color = 'white';
        }
    }
    
    // 【新功能】 控制悔棋按钮的可用状态
    const canUndo = myColor && gameState.last_move_color === myColor;
    undoButton.disabled = !canUndo;

    if (gameState.last_move_color) { lastMoveInfo.innerHTML = `最近操作: <span class="score-color-box" style="background-color:${gameState.last_move_color};"></span>`; } else { lastMoveInfo.innerHTML = ''; }
    scoresTableBody.innerHTML = '';
    gameState.players.forEach(color => { const score = gameState.scores[color] || 0; const lineCount = gameState.line_counts[color] || 0; const row = scoresTableBody.insertRow(); row.insertCell().innerHTML = `<span class="score-color-box" style="background-color:${color};"></span>`; row.insertCell().textContent = lineCount; row.insertCell().textContent = score; });
    document.querySelectorAll('.game-point').forEach(c => c.classList.remove('selected'));
    selectedPoints.forEach(p => { document.querySelector(`.game-point[data-q='${p[0]}'][data-r='${p[1]}']`)?.classList.add('selected'); });

    // 【新功能】游戏结束时弹窗显示胜利者
    if (gameState.game_over && !window._victoryShown) {
        window._victoryShown = true;
        // 计算最高分
        const scores = gameState.scores || {};
        let maxScore = -Infinity;
        let winners = [];
        for (const color of gameState.players) {
            const score = scores[color] || 0;
            if (score > maxScore) {
                maxScore = score;
                winners = [color];
            } else if (score === maxScore) {
                winners.push(color);
            }
        }
        // 构造弹窗内容
        let msg = '';
        if (winners.length === 1) {
            msg = `胜利者：<span class=\"score-color-box\" style=\"background-color:${winners[0]}\"></span> <b>${winners[0]}</b> 占有三角形数：${maxScore}`;
        } else {
            msg = `并列胜利：` + winners.map(c => `<span class=\"score-color-box\" style=\"background-color:${c}\"></span> <b>${c}</b>`).join('、') + `，均占有三角形数：${maxScore}`;
        }
        // 创建弹窗
        const div = document.createElement('div');
        div.innerHTML = `<div style=\"position:fixed;z-index:9999;left:0;top:0;width:100vw;height:100vh;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;\"><div style=\"background:#fff;padding:32px 24px;border-radius:12px;box-shadow:0 8px 32px #0002;text-align:center;min-width:260px;\"><h2>游戏结束</h2><div style=\"margin:18px 0;font-size:1.1em;\">${msg}</div><button style=\"margin-top:10px;padding:8px 24px;font-size:1em;border-radius:6px;border:none;background:#428bca;color:#fff;cursor:pointer;\" onclick=\"this.closest('div[style*=&quot;position:fixed&quot;]').remove();\">关闭</button></div></div>`;
        document.body.appendChild(div.firstChild);
    }
    if (!gameState.game_over) {
        window._victoryShown = false;
    }
}

async function onPointClick(event) {
    if (!isMyTurn() || gameState.game_over) return;
    const point = [parseInt(event.target.dataset.q), parseInt(event.target.dataset.r)];
    const index = selectedPoints.findIndex(p => p[0] === point[0] && p[1] === point[1]);
    if (index > -1) { selectedPoints.splice(index, 1); } else { selectedPoints.push(point); }
    if (selectedPoints.length === 2) { const pointsToSubmit = [...selectedPoints]; selectedPoints = []; await makeMove(pointsToSubmit[0], pointsToSubmit[1]); }
    updateUI();
}

async function makeMove(p1, p2) { try { const response = await fetch('/api/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p1, p2 }) }); if (!response.ok) { const data = await response.json(); alert('错误: ' + data.error); } await fetchGameState(); } catch (error) { console.error("请求失败:", error); } }
async function selectMyColor(color) {
    sessionStorage.setItem('myColor', color);
    await fetch('/api/select_color', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color }) });
    myColor = color;
    await fetchGameState(); 
}
async function selectFollowColor(color) {
    sessionStorage.setItem('followColor', color);
    followColor = color;
    updateUI();
}

// 【新功能】 悔棋操作的处理函数
async function handleUndo() {
    try {
        const response = await fetch('/api/undo', { method: 'POST' });
        if (!response.ok) {
            const data = await response.json();
            alert('无法悔棋: ' + data.error);
        }
        await fetchGameState();
    } catch (error) {
        console.error("悔棋失败:", error);
    }
}

async function fetchGameState() { 
    if (isFetching) return; isFetching = true; 
    try { 
        const response = await fetch('/api/gamestate'); 
        const data = await response.json();
        const boardChanged = JSON.stringify(gameState) !== JSON.stringify(data.game);
        gameState = data.game; 
        if (data.my_color) { myColor = data.my_color; sessionStorage.setItem('myColor', myColor); } 
        if (boardChanged) { drawBoard(); } 
        updateUI(); 
    } catch (error) { 
        console.error("获取状态失败:", error); 
    } finally { 
        isFetching = false; 
    } 
}

async function init() {
    if (!sessionStorage.getItem('_color_init')) {
        sessionStorage.removeItem('myColor');
        sessionStorage.removeItem('followColor');
        sessionStorage.setItem('_color_init', '1');
        myColor = null;
        followColor = null;
    }
    resetButton.addEventListener('click', async () => { if(confirm("确定要重置整个棋盘吗？所有人的进度都将丢失！")) { await fetch('/api/reset', { method: 'POST' }); await fetchGameState(); } });
    // 【新功能】 为悔棋按钮绑定事件
    undoButton.addEventListener('click', handleUndo);

    // 游戏说明弹窗逻辑
    document.getElementById('help-button').addEventListener('click', () => {
        if (document.getElementById('help-modal')) return;
        const helpDiv = document.createElement('div');
        helpDiv.id = 'help-modal';
        helpDiv.innerHTML = `
        <div style="position:fixed;z-index:10000;left:0;top:0;width:100vw;height:100vh;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;">
          <div style="background:#fff;max-width:95vw;width:400px;padding:28px 18px 18px 18px;border-radius:14px;box-shadow:0 8px 32px #0002;text-align:left;position:relative;font-size:1.05em;line-height:1.7;">
            <button style="position:absolute;right:12px;top:10px;font-size:1.3em;background:none;border:none;cursor:pointer;color:#888;" onclick=\"this.closest('#help-modal').remove()\">×</button>
            <h2 style="text-align:center;margin-top:0;font-size:1.3em;">游戏说明</h2>
            <div style="max-height:60vh;overflow:auto;">
              <ol style="padding-left:1.2em;">
                <li>棋盘为六边形，由点组成。</li>
                <li>每位玩家进入页面后，需选择一个颜色作为身份，并选择跟随的颜色。</li>
                <li>玩家每回合可在棋盘上放置一条长度为4的直线（覆盖4个连续的点，且必须为直线，不能与已有线完全重合）。</li>
                <li>放置线条后，如果新围成了一个小三角形（可以与其他已有的任何颜色的线一起围成），则该三角形会被染上当前线条的颜色。</li>
                <li>每个三角形只能被染色一次，归属于第一个围成它的玩家。</li>
                <li>游戏持续进行，直到所有三角形都被染色，游戏结束。</li>
                <li>支持悔棋（只能撤销自己下的最后一步），支持棋盘重置。</li>
                <li>分数榜实时更新，胜利者为占有三角形最多的颜色（并列第一则都为胜利）。</li>
              </ol>
            </div>
          </div>
        </div>`;
        document.body.appendChild(helpDiv);
    });

    await fetchGameState(); 
    setInterval(fetchGameState, 2000);
}

init(); 