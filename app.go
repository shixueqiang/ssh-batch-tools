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
)

const configPath = "servers.json"

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
	var authMethods []ssh.AuthMethod

	if server.PrivateKey != "" {
		// 1. 解析私钥
		signer, err := ssh.ParsePrivateKey([]byte(server.PrivateKey))
		if err != nil {
			return "", fmt.Errorf("解析私钥失败: %v", err)
		}
		authMethods = append(authMethods, ssh.PublicKeys(signer))
	} else {
		// 2. 使用密码
		authMethods = append(authMethods, ssh.Password(server.Password))
	}

	config := &ssh.ClientConfig{
		User:            server.User,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         5 * time.Second,
	}

	addr := net.JoinHostPort(server.IP, strconv.Itoa(server.Port))
	client, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		return "", err
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	output, err := session.CombinedOutput(cmd)
	return string(output), err
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
