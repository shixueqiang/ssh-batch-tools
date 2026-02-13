package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/ssh"
	"golang.org/x/net/proxy"
)

const (
	configPath   = "servers.json"
	settingsPath = "settings.json"
)

// GlobalSettings 全局配置结构体
type GlobalSettings struct {
	Timeout       int    `json:"timeout"`
	UseProxy      bool   `json:"useProxy"`
	ProxyHost     string `json:"proxyHost"`
	ProxyPort     int    `json:"proxyPort"`
	ProxyUser     string `json:"proxyUser"`
	ProxyPassword string `json:"proxyPassword"`
}

type ServerInfo struct {
	Id         string `json:"id"`
	Name       string `json:"name"`
	IP         string `json:"ip"`
	Port       int    `json:"port"`
	User       string `json:"user"`
	Password   string `json:"password"`
	PrivateKey string `json:"privateKey"`
}

type ExecResult struct {
	Name   string `json:"name"`
	IP     string `json:"ip"`
	Output string `json:"output"`
	Error  string `json:"error"`
}

// App struct
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// BatchExecute 暴露给前端的方法
func (a *App) BatchExecute(servers []ServerInfo, command string) {
	numServers := len(servers)
	if numServers == 0 {
		return
	}

	// 1. 定义并发限制（例如同时只允许 10 个 SSH 连接）
	workerCount := 10
	if numServers < workerCount {
		workerCount = numServers
	}

	// 2. 创建任务通道
	jobs := make(chan ServerInfo, numServers)
	var wg sync.WaitGroup

	// 3. 启动固定数量的 Worker 协程
	for w := 1; w <= workerCount; w++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			// 核心救命代码：捕获 Panic，防止整个程序崩溃
			defer func() {
				if r := recover(); r != nil {
					runtime.EventsEmit(a.ctx, "ssh_log", ExecResult{
						Output: fmt.Sprintf("[Worker %d] 发生了致命内部错误: %v", workerID, r),
						Error:  "INTERNAL_PANIC",
					})
				}
			}()
			// 每个 Worker 持续从 jobs 通道中取任务，直到通道关闭
			for server := range jobs {
				// 发送初始状态
				runtime.EventsEmit(a.ctx, "ssh_log", ExecResult{
					Name:   server.Name,
					IP:     server.IP,
					Output: fmt.Sprintf("[Worker %d] 正在连接...", workerID),
				})

				// 执行真正的 SSH 逻辑
				output, err := a.runSingleSSH(server, command)

				result := ExecResult{
					Name:   server.Name,
					IP:     server.IP,
					Output: output,
				}
				if err != nil {
					result.Error = err.Error()
				}

				// 推送结果到前端
				runtime.EventsEmit(a.ctx, "ssh_log", result)
			}
		}(w)
	}

	// 4. 将所有任务塞进通道
	for _, s := range servers {
		jobs <- s
	}

	// 5. 关闭通道并等待 Worker 完成
	close(jobs) // 通知 Worker 们没有新活儿了

	go func() {
		wg.Wait()
		runtime.EventsEmit(a.ctx, "ssh_complete", "所有任务已执行完毕")
	}()
}

// 私有方法：处理单台服务器的 SSH 连接
func (a *App) runSingleSSH(server ServerInfo, cmd string) (string, error) {
	// 每次执行前加载最新全局设置
	settings := a.LoadSettings()

	var authMethods []ssh.AuthMethod
	if server.PrivateKey != "" {
		signer, err := ssh.ParsePrivateKey([]byte(server.PrivateKey))
		if err != nil {
			return "", fmt.Errorf("解析私钥失败: %v", err)
		}
		authMethods = append(authMethods, ssh.PublicKeys(signer))
	} else {
		authMethods = append(authMethods, ssh.Password(server.Password))
	}

	config := &ssh.ClientConfig{
		User:            server.User,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		// 使用全局设置中的超时时间
		Timeout: time.Duration(settings.Timeout) * time.Second,
	}

	targetAddr := net.JoinHostPort(server.IP, strconv.Itoa(server.Port))

	var conn net.Conn
	var err error

	// 处理代理逻辑
	if settings.UseProxy && settings.ProxyHost != "" {
		proxyAddr := net.JoinHostPort(settings.ProxyHost, strconv.Itoa(settings.ProxyPort))
		var auth *proxy.Auth
		if settings.ProxyUser != "" {
			auth = &proxy.Auth{User: settings.ProxyUser, Password: settings.ProxyPassword}
		}

		// 创建 SOCKS5 代理拨号器
		dialer, err := proxy.SOCKS5("tcp", proxyAddr, auth, proxy.Direct)
		if err != nil {
			return "", fmt.Errorf("无法连接到代理服务器: %v", err)
		}

		// 通过代理拨号目标服务器
		conn, err = dialer.Dial("tcp", targetAddr)
	} else {
		// 普通 TCP 直接拨号
		conn, err = net.DialTimeout("tcp", targetAddr, config.Timeout)
	}

	if err != nil {
		return "", fmt.Errorf("网络连接失败: %v", err)
	}
	defer conn.Close()

	// 在已建立的底层连接（直接连接或代理连接）上初始化 SSH
	sshConn, chans, reqs, err := ssh.NewClientConn(conn, targetAddr, config)
	if err != nil {
		return "", fmt.Errorf("SSH 握手失败: %v", err)
	}
	client := ssh.NewClient(sshConn, chans, reqs)
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	output, err := session.CombinedOutput(cmd)
	return string(output), err
}

// LoadSettings 加载配置
func (a *App) LoadSettings() GlobalSettings {
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		// 默认配置
		return GlobalSettings{Timeout: 5, UseProxy: false}
	}
	var s GlobalSettings
	json.Unmarshal(data, &s)
	return s
}

// SaveSettings 保存配置
func (a *App) SaveSettings(s GlobalSettings) error {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(settingsPath, data, 0644)
}

// LoadServers 从本地读取
func (a *App) LoadServers() ([]ServerInfo, error) {
	// 如果文件不存在，返回空列表而不是报错
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		return []ServerInfo{}, nil
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, err
	}

	var servers []ServerInfo
	err = json.Unmarshal(data, &servers)
	return servers, err
}

// SaveServers 保存到本地
func (a *App) SaveServers(servers []ServerInfo) error {
	data, err := json.MarshalIndent(servers, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(configPath, data, 0644)
}
