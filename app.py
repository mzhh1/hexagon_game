# app.py

import os
import copy # 【新功能】导入copy模块用于深度复制
from flask import Flask, render_template, jsonify, request, session

app = Flask(__name__)
app.secret_key = os.urandom(24) 

# 全局变量作为所有会话共享的棋盘状态
GAME_STATE = {}
# 【新功能】 存储游戏状态的历史记录
GAME_STATE_HISTORY = []


def _get_serializable_state():
    if not GAME_STATE:
        return {}
    state_copy = GAME_STATE.copy()
    state_copy.pop('segments', None)
    state_copy.pop('drawn_lines', None)
    return state_copy

AXIAL_DIRECTIONS = [(1, 0), (0, 1), (-1, 1), (-1, 0), (0, -1), (1, -1)]
def axial_add(p1, p2): return (p1[0] + p2[0], p1[1] + p2[1])

def get_line_points(p1, p2):
    distance = (abs(p1[0] - p2[0]) + abs(p1[1] - p2[1]) + abs(p1[0] + p1[1] - p2[0] - p2[1])) / 2
    if distance != 3: return None
    direction_q, direction_r = (p2[0] - p1[0]) / 3, (p2[1] - p1[1]) / 3
    is_straight_line = any(abs(d[0] - direction_q) < 1e-9 and abs(d[1] - direction_r) < 1e-9 for d in AXIAL_DIRECTIONS)
    if not is_straight_line: return None
    p_mid1, p_mid2 = (p1[0] + direction_q, p1[1] + direction_r), (p1[0] + 2 * direction_q, p1[1] + 2 * direction_r)
    if not (p_mid1[0].is_integer() and p_mid1[1].is_integer()): return None
    return [p1, (int(p_mid1[0]), int(p_mid1[1])), (int(p_mid2[0]), int(p_mid2[1])), p2]

def reset_game():
    global GAME_STATE, GAME_STATE_HISTORY
    # 【新功能】 重置游戏时清空历史记录
    GAME_STATE_HISTORY.clear()
    
    points, all_triangles = set(), []
    radius = 3
    for q in range(-radius, radius + 1):
        for r in range(-radius, radius + 1):
            if abs(q + r) <= radius: points.add((q, r))
    for point in points:
        for d1, d2 in [(AXIAL_DIRECTIONS[0], AXIAL_DIRECTIONS[1]), (AXIAL_DIRECTIONS[0], AXIAL_DIRECTIONS[5])]:
            p1, p2, p3 = point, axial_add(point, d1), axial_add(point, d2)
            if p2 in points and p3 in points: all_triangles.append(frozenset([p1, p2, p3]))
    
    colors = ['#d9534f', '#428bca', '#5cb85c', '#f0ad4e', '#6e409e']

    GAME_STATE = {
        'players': colors,
        'points': list(points),
        'lines': [],
        'drawn_lines': set(),
        'segments': set(),
        'all_possible_triangles': [list(t) for t in set(all_triangles)],
        'captured_triangles': [],
        'scores': {color: 0 for color in colors},
        'line_counts': {color: 0 for color in colors},
        'last_move_color': None,
        'game_over': False,
        'message': "欢迎来到共享棋盘！请选择一个颜色开始游戏。"
    }

@app.before_request
def ensure_game_exists():
    if not GAME_STATE:
        reset_game()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/gamestate')
def get_gamestate():
    return jsonify({
        'game': _get_serializable_state(),
        'my_color': session.get('player_color', None)
    })

@app.route('/api/select_color', methods=['POST'])
def select_color():
    data = request.get_json()
    color = data.get('color')
    if color not in GAME_STATE.get('players', []):
        return jsonify({'error': '无效的颜色'}), 400
    session['player_color'] = color
    return jsonify({'message': f'颜色已选择: {color}'})

@app.route('/api/reset', methods=['POST'])
def handle_reset():
    reset_game()
    return jsonify(_get_serializable_state())

# 【新功能】 新增悔棋API
@app.route('/api/undo', methods=['POST'])
def handle_undo():
    global GAME_STATE
    
    # 检查用户是否登录（选择了颜色）
    if 'player_color' not in session:
        return jsonify({'error': '请先选择你的颜色'}), 403
    
    # 检查是否有历史记录
    if not GAME_STATE_HISTORY:
        return jsonify({'error': '没有可悔棋的步骤'}), 400

    # 检查最近一步棋是否是当前用户下的
    if GAME_STATE.get('last_move_color') != session.get('player_color'):
        return jsonify({'error': '只能撤销自己下的最后一步棋'}), 403

    # 执行悔棋：从历史记录中恢复上一个状态
    GAME_STATE = GAME_STATE_HISTORY.pop()
    
    return jsonify(_get_serializable_state())


@app.route('/api/move', methods=['POST'])
def make_move():
    if 'player_color' not in session:
        return jsonify({'error': '在放置线条前，请先选择一个颜色。'}), 403
    if GAME_STATE.get('game_over', True):
        return jsonify({'error': '游戏已经结束！'}), 400

    # 【新功能】 在执行移动前，保存当前状态到历史记录
    # 使用 deepcopy 确保所有嵌套的列表和字典都被复制，而不是引用
    GAME_STATE_HISTORY.append(copy.deepcopy(GAME_STATE))
    # 保持历史记录栈不要过大（例如，最多20步）
    if len(GAME_STATE_HISTORY) > 20:
        GAME_STATE_HISTORY.pop(0)

    data = request.get_json()
    p1 = tuple(data['p1'])
    p2 = tuple(data['p2'])
    
    line_points = get_line_points(p1, p2)
    if not line_points:
        GAME_STATE_HISTORY.pop() # 如果移动无效，把刚刚存的状态弹出去
        return jsonify({'error': '无效的移动。请选择形成长度为4的直线的两点。'}), 400

    canonical_line = tuple(sorted([p1, p2]))
    if canonical_line in GAME_STATE['drawn_lines']:
        GAME_STATE_HISTORY.pop() # 如果移动无效，把刚刚存的状态弹出去
        return jsonify({'error': '无效的移动。这条线已经存在。'}), 400

    current_player_color = session['player_color']
    GAME_STATE['drawn_lines'].add(canonical_line)
    GAME_STATE['lines'].append({'points': line_points, 'color': current_player_color})
    
    GAME_STATE['line_counts'][current_player_color] += 1
    GAME_STATE['last_move_color'] = current_player_color

    for i in range(len(line_points) - 1):
        GAME_STATE['segments'].add(frozenset([line_points[i], line_points[i+1]]))

    captured_points_sets = {frozenset(t['points']) for t in GAME_STATE['captured_triangles']}
    for tri_points in GAME_STATE['all_possible_triangles']:
        tri_set = frozenset(tri_points)
        if tri_set not in captured_points_sets:
            p1_tri, p2_tri, p3_tri = tri_points[0], tri_points[1], tri_points[2]
            s1, s2, s3 = frozenset([p1_tri, p2_tri]), frozenset([p2_tri, p3_tri]), frozenset([p3_tri, p1_tri])
            if s1 in GAME_STATE['segments'] and s2 in GAME_STATE['segments'] and s3 in GAME_STATE['segments']:
                GAME_STATE['captured_triangles'].append({'points': tri_points, 'color': current_player_color})
                GAME_STATE['scores'][current_player_color] += 1
                captured_points_sets.add(tri_set)

    if len(GAME_STATE['captured_triangles']) == len(GAME_STATE['all_possible_triangles']):
        GAME_STATE['game_over'] = True
        GAME_STATE['message'] = "游戏结束！所有三角形已被填充。"
    
    return jsonify(_get_serializable_state())

if __name__ == '__main__':
    app.run(debug=True, host='::', port=5001)