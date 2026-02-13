import React, { useState, useEffect, useRef } from 'react';
import { LoadServers, SaveServers, BatchExecute } from '../wailsjs/go/main/App';
import { EventsOn } from '../wailsjs/runtime/runtime';

function App() {
    const [view, setView] = useState('list');
    const [servers, setServers] = useState([]);
    const [selectedIds, setSelectedIds] = useState([]);
    const [command, setCommand] = useState("");
    const [logs, setLogs] = useState([]);
    const logEndRef = useRef(null);

    // --- 新增：搜索状态 ---
    const [searchTerm, setSearchTerm] = useState("");

    const [formData, setFormData] = useState({
        name: '', ip: '', port: 22, user: 'root', password: '', privateKey: ''
    });
    const [authType, setAuthType] = useState('password');

    // --- 新增：实时过滤逻辑 ---
    const filteredServers = servers.filter(s =>
        s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.ip.includes(searchTerm)
    );

    // --- 新增：全选/取消全选 (仅针对过滤后的结果) ---
    const handleSelectFiltered = () => {
        const filteredIds = filteredServers.map(s => s.id);
        // 合并当前已选和搜索出的 ID (使用 Set 去重)
        setSelectedIds(prev => Array.from(new Set([...prev, ...filteredIds])));
    };

    const handleDeselectFiltered = () => {
        const filteredIds = filteredServers.map(s => s.id);
        // 从当前已选中移除搜索出的 ID
        setSelectedIds(prev => prev.filter(id => !filteredIds.includes(id)));
    };

    // 判断当前过滤出的服务器是否全部被选中
    const isAllFilteredSelected = filteredServers.length > 0 &&
        filteredServers.every(s => selectedIds.includes(s.id));

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    useEffect(() => {
        LoadServers().then(setServers).catch(console.error);

        const unregister = EventsOn("ssh_log", (res) => {
            setLogs(prev => [...prev, {
                id: Date.now() + Math.random(),
                name: res.name,
                ip: res.ip,
                content: res.error ? `❌ 失败: ${res.error}` : `✅ 成功: ${res.output}`,
                isError: !!res.error,
                time: new Date().toLocaleTimeString()
            }]);
        });
        return () => unregister();
    }, []);

    const handleAddServer = () => {
        if (!formData.ip || !formData.name) return alert("名称和IP不能为空");
        const newServer = { ...formData, id: Date.now().toString() };
        const newList = [...servers, newServer];
        SaveServers(newList).then(() => {
            setServers(newList);
            setView('list');
            setFormData({ name: '', ip: '', port: 22, user: 'root', password: '', privateKey: '' });
        });
    };

    const handleDeleteServer = (id) => {
        if (!window.confirm("确定要删除该服务器配置吗？")) return;
        const newList = servers.filter(s => s.id !== id);
        SaveServers(newList).then(() => {
            setServers(newList);
            setSelectedIds(prev => prev.filter(selectedId => selectedId !== id));
        });
    };

    const run = () => {
        const targets = servers.filter(s => selectedIds.includes(s.id));
        if (targets.length === 0) return alert("请选择服务器");
        if (!command) return alert("请输入指令");
        BatchExecute(targets, command);
    };

    return (
        <div style={{ padding: '20px', backgroundColor: '#1b2636', color: '#fff', minHeight: '100vh', fontFamily: 'Segoe UI, sans-serif' }}>

            {/* 导航栏 */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                <button onClick={() => setView('list')} style={btnStyle(view === 'list')}>服务器列表</button>
                <button onClick={() => setView('add')} style={btnStyle(view === 'add')}>+ 添加服务器</button>
                <button onClick={() => setLogs([])} style={{ ...btnStyle(false), marginLeft: 'auto', backgroundColor: '#e67e22' }}>清空日志</button>
            </div>

            {view === 'list' && (
                <div>
                    {/* --- 新增：搜索与批量操作栏 --- */}
                    <div style={{ marginBottom: '15px', display: 'flex', gap: '15px', alignItems: 'center' }}>
                        <div style={{ position: 'relative', flex: 1 }}>
                            <input
                                style={searchInputStyle}
                                placeholder="🔍 搜索名称或 IP..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                            {searchTerm && <span onClick={() => setSearchTerm("")} style={clearSearchStyle}>✕</span>}
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={handleSelectFiltered} style={miniBtnStyle}>全选</button>
                            <button onClick={handleDeselectFiltered} style={miniBtnStyle}>取消全选</button>
                        </div>
                        <span style={{ fontSize: '12px', color: '#888' }}>
                            显示 {filteredServers.length} / 总计 {servers.length} (已选 {selectedIds.length})
                        </span>
                    </div>

                    <div style={panelStyle}>
                        <table width="100%" style={{ borderCollapse: 'collapse' }}>
                            <thead style={{ backgroundColor: '#2c3e50', textAlign: 'left', position: 'sticky', top: 0 }}>
                                <tr>
                                    <th style={thStyle}>
                                        <input
                                            type="checkbox"
                                            checked={isAllFilteredSelected}
                                            onChange={isAllFilteredSelected ? handleDeselectFiltered : handleSelectFiltered}
                                        />
                                    </th>
                                    <th style={thStyle}>名称</th>
                                    <th style={thStyle}>IP地址</th>
                                    <th style={thStyle}>用户</th>
                                    <th style={thStyle}>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredServers.map(s => (
                                    <tr key={s.id} style={{
                                        borderBottom: '1px solid #2c3e50',
                                        backgroundColor: selectedIds.includes(s.id) ? '#243b55' : 'transparent'
                                    }}>
                                        <td style={tdStyle}>
                                            <input type="checkbox" checked={selectedIds.includes(s.id)} onChange={() => {
                                                setSelectedIds(prev => prev.includes(s.id) ? prev.filter(id => id !== s.id) : [...prev, s.id])
                                            }} />
                                        </td>
                                        <td style={tdStyle}>{s.name}</td>
                                        <td style={tdStyle}>{s.ip}:{s.port}</td>
                                        <td style={tdStyle}>{s.user}</td>
                                        <td style={tdStyle}>
                                            <button onClick={() => handleDeleteServer(s.id)} style={deleteBtnStyle}>删除</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div style={{ marginTop: '20px', display: 'flex' }}>
                        <input
                            placeholder="输入批量执行指令 (例如: docker ps 或 ls -l)"
                            style={inputStyle}
                            value={command}
                            onChange={e => setCommand(e.target.value)}
                        />
                        <button onClick={run} style={runBtnStyle}>执行批量命令</button>
                    </div>

                    <div style={logPanelStyle}>
                        {logs.length === 0 && <div style={{ color: '#555' }}>等待指令下发...</div>}
                        {logs.map((log) => (
                            <div key={log.id} style={{
                                borderBottom: '1px solid #1a1a1a',
                                padding: '5px 0',
                                color: log.isError ? '#ff4d4f' : '#52c41a',
                                textAlign: 'left'
                            }}>
                                <span style={{ color: '#888', marginRight: '8px' }}>[{log.time}]</span>
                                <span style={{ fontWeight: 'bold', marginRight: '8px' }}>{log.name} ({log.ip}):</span>
                                <pre style={{ margin: '5px 0 0 0', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>{log.content}</pre>
                            </div>
                        ))}
                        <div ref={logEndRef} />
                    </div>
                </div>
            )}

            {/* 添加服务器视图保持不变... */}
            {view === 'add' && (
                <div style={{ maxWidth: '450px', margin: '40px auto', background: '#2c3e50', padding: '30px', borderRadius: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.3)' }}>
                    <h3 style={{ marginTop: 0 }}>配置新服务器</h3>
                    <div style={formGroup}><label>名称 (备注):</label><input style={inputStyleFull} value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="如: 阿拉德-1服" /></div>
                    <div style={formGroup}><label>IP 地址:</label><input style={inputStyleFull} value={formData.ip} onChange={e => setFormData({ ...formData, ip: e.target.value })} placeholder="1.2.3.4" /></div>
                    <div style={formGroup}><label>端口:</label><input type="number" style={inputStyleFull} value={formData.port} onChange={e => setFormData({ ...formData, port: parseInt(e.target.value) })} /></div>
                    <div style={formGroup}><label>用户名:</label><input style={inputStyleFull} value={formData.user} onChange={e => setFormData({ ...formData, user: e.target.value })} /></div>
                    <div style={formGroup}>
                        <label>认证方式:</label>
                        <select style={inputStyleFull} value={authType} onChange={(e) => setAuthType(e.target.value)}>
                            <option value="password">密码认证</option>
                            <option value="key">私钥认证 (OpenSSH)</option>
                        </select>
                    </div>
                    {authType === 'password' ? (
                        <div style={formGroup}><label>密码:</label><input type="password" style={inputStyleFull} value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} /></div>
                    ) : (
                        <div style={formGroup}>
                            <label>私钥内容:</label>
                            <textarea style={{ ...inputStyleFull, height: '100px', fontFamily: 'monospace' }} value={formData.privateKey} onChange={e => setFormData({ ...formData, privateKey: e.target.value })} />
                        </div>
                    )}
                    <button onClick={handleAddServer} style={{ ...runBtnStyle, width: '100%', marginLeft: 0, marginTop: '10px' }}>保存到本地</button>
                </div>
            )}
        </div>
    );
}

// --- 新增/更新的样式定义 ---
const searchInputStyle = {
    width: '100%',
    padding: '10px 35px 10px 12px',
    background: '#0d1117',
    border: '1px solid #30363d',
    color: '#c9d1d9',
    borderRadius: '6px',
    fontSize: '14px',
    boxSizing: 'border-box'
};

const clearSearchStyle = {
    position: 'absolute',
    right: '10px',
    top: '10px',
    cursor: 'pointer',
    color: '#888',
    fontSize: '14px'
};

const miniBtnStyle = {
    padding: '6px 12px',
    backgroundColor: '#34495e',
    color: '#ecf0f1',
    border: '1px solid #5d6d7e',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px'
};

const btnStyle = (active) => ({
    padding: '10px 20px',
    backgroundColor: active ? '#3498db' : '#2c3e50',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: '0.2s',
    fontWeight: 'bold'
});

const thStyle = { padding: '12px', borderBottom: '2px solid #1b2636' };
const tdStyle = { padding: '10px' };
const deleteBtnStyle = { backgroundColor: '#c0392b', color: 'white', border: 'none', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' };
const panelStyle = { height: '280px', overflowY: 'auto', background: '#0d1117', padding: '10px', borderRadius: '8px', border: '1px solid #30363d' };
const logPanelStyle = { height: '350px', overflowY: 'auto', background: '#000', padding: '15px', marginTop: '20px', borderRadius: '8px', border: '1px solid #333' };
const inputStyle = { flex: 1, padding: '12px', background: '#0d1117', border: '1px solid #30363d', color: '#52c41a', borderRadius: '6px', fontFamily: 'monospace' };
const inputStyleFull = { width: '100%', padding: '10px', background: '#1b2636', border: '1px solid #444', color: '#fff', borderRadius: '6px', boxSizing: 'border-box' };
const runBtnStyle = { padding: '10px 25px', backgroundColor: '#27ae60', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', marginLeft: '10px', fontWeight: 'bold' };
const formGroup = { marginBottom: '15px', display: 'flex', flexDirection: 'column', gap: '5px' };

export default App;