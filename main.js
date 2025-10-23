const { app, BrowserWindow, ipcMain, Notification, dialog, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let scheduleWindow;
let tray;
let isQuitting = false;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        icon: path.join(__dirname, 'assets/icon.png'),
        show: false
    });

    mainWindow.loadFile('index.html');

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // 关闭窗口时隐藏而不是退出
    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
            return false;
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // 最小化到系统托盘
    mainWindow.on('minimize', (event) => {
        event.preventDefault();
        mainWindow.hide();
    });

    // 创建系统托盘
    createTray();
}

function createTray() {
    // 尝试多个图标路径（优先级从高到低）
    const iconPaths = [
        path.join(__dirname, 'assets/tray-icon.png'),     // 专用托盘图标
        path.join(__dirname, 'assets/icon.png'),          // 应用图标（备用）
        path.join(process.resourcesPath, 'assets/icon.png') // 打包后路径
    ];
    
    let iconPath = null;
    for (const p of iconPaths) {
        if (fs.existsSync(p)) {
            iconPath = p;
            console.log('使用图标:', p);
            break;
        }
    }
    
    if (!iconPath) {
        console.error('❌ 找不到任何图标文件，托盘功能将不可用');
        console.error('请确保以下任一文件存在：');
        iconPaths.forEach(p => console.error('  -', p));
        return;
    }
    
    // 加载图标并调整大小（适配托盘显示）
    let icon = nativeImage.createFromPath(iconPath);
    
    // 如果图标太大，缩小到托盘合适的尺寸
    const size = icon.getSize();
    if (size.width > 32 || size.height > 32) {
        icon = icon.resize({ width: 16, height: 16 });
    }
    
    tray = new Tray(icon);
    
    const contextMenu = Menu.buildFromTemplate([
        {
            label: '显示主窗口',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        {
            label: '添加日程',
            click: () => {
                createScheduleWindow();
            }
        },
        {
            type: 'separator'
        },
        {
            label: '退出',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);
    
    tray.setToolTip('日程提醒助手');
    tray.setContextMenu(contextMenu);
    
    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
                mainWindow.focus();
            }
        }
    });
    
    console.log('✅ 托盘图标创建成功');
}

function createScheduleWindow() {
    if (scheduleWindow) {
        scheduleWindow.focus();
        return;
    }

    scheduleWindow = new BrowserWindow({
        width: 600,
        height: 500,
        parent: mainWindow,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        resizable: false,
        maximizable: false
    });

    scheduleWindow.loadFile('schedule-form.html');
    
    scheduleWindow.on('closed', () => {
        scheduleWindow = null;
    });
}

// 日程提醒系统
class ScheduleReminder {
    constructor() {
        this.schedules = [];
        this.reminderIntervals = new Map();
        this.loadSchedules();
    }

    loadSchedules() {
        const dataPath = path.join(app.getPath('userData'), 'schedules.json');
        
        try {
            if (fs.existsSync(dataPath)) {
                const data = fs.readFileSync(dataPath, 'utf8');
                this.schedules = JSON.parse(data);
                this.startAllReminders();
            }
        } catch (error) {
            console.error('加载日程失败:', error);
        }
    }

    saveSchedules() {
        const dataPath = path.join(app.getPath('userData'), 'schedules.json');
        
        try {
            fs.writeFileSync(dataPath, JSON.stringify(this.schedules, null, 2));
        } catch (error) {
            console.error('保存日程失败:', error);
        }
    }

    addSchedule(schedule) {
        this.schedules.push(schedule);
        this.saveSchedules();
        this.startReminder(schedule);
    }

    updateSchedule(id, updatedSchedule) {
        const index = this.schedules.findIndex(s => s.id === id);
        if (index !== -1) {
            this.stopReminder(id);
            this.schedules[index] = { ...this.schedules[index], ...updatedSchedule };
            this.saveSchedules();
            this.startReminder(this.schedules[index]);
        }
    }

    deleteSchedule(id) {
        this.stopReminder(id);
        this.schedules = this.schedules.filter(s => s.id !== id);
        this.saveSchedules();
    }

    startAllReminders() {
        this.schedules.forEach(schedule => {
            if (!schedule.completed) {
                this.startReminder(schedule);
            }
        });
    }

    startReminder(schedule) {
        this.stopReminder(schedule.id);
        
        const now = new Date();
        const scheduleDateTime = new Date(`${schedule.date}T${schedule.startTime}`);
        const reminderTime = new Date(scheduleDateTime.getTime() - 15 * 60 * 1000); // 提前15分钟提醒
        
        if (reminderTime > now) {
            const timeout = reminderTime.getTime() - now.getTime();
            
            const timeoutId = setTimeout(() => {
                this.showNotification(schedule);
                
                // 设置重复提醒（每5分钟一次，直到日程开始）
                const repeatInterval = setInterval(() => {
                    const currentTime = new Date();
                    if (currentTime >= scheduleDateTime) {
                        this.stopReminder(schedule.id);
                    } else {
                        this.showNotification(schedule, true);
                    }
                }, 5 * 60 * 1000);
                
                this.reminderIntervals.set(schedule.id, { timeout: timeoutId, interval: repeatInterval });
            }, timeout);
            
            this.reminderIntervals.set(schedule.id, { timeout: timeoutId });
        }
    }

    stopReminder(id) {
        const intervals = this.reminderIntervals.get(id);
        if (intervals) {
            if (intervals.timeout) clearTimeout(intervals.timeout);
            if (intervals.interval) clearInterval(intervals.interval);
            this.reminderIntervals.delete(id);
        }
    }

    showNotification(schedule, isRepeat = false) {
        const notification = new Notification({
            title: isRepeat ? '⏰ 日程提醒（重复）' : '⏰ 日程提醒',
            body: `${schedule.content}\n时间: ${this.formatTime(schedule.startTime)} - ${this.formatTime(schedule.endTime)}`,
            silent: false,
            timeoutType: 'never'
        });

        notification.on('click', () => {
            if (mainWindow) {
                mainWindow.show();
                mainWindow.focus();
            }
        });

        notification.show();

        // 播放提醒音效
        this.playReminderSound();
    }

    playReminderSound() {
        const { exec } = require('child_process');
        
        // 根据操作系统播放不同的提示音
        switch (process.platform) {
            case 'darwin': // macOS
                exec('afplay /System/Library/Sounds/Glass.aiff');
                break;
            case 'win32': // Windows
                exec('powershell -c (New-Object Media.SoundPlayer "C:\\Windows\\Media\\notify.wav").PlaySync();');
                break;
            case 'linux': // Linux
                exec('paplay /usr/share/sounds/freedesktop/stereo/message.oga');
                break;
        }
    }

    formatTime(timeString) {
        const [hours, minutes] = timeString.split(':');
        const hour = parseInt(hours);
        const period = hour >= 12 ? '下午' : '上午';
        const displayHour = hour > 12 ? hour - 12 : hour;
        return `${period}${displayHour}:${minutes}`;
    }

    getUpcomingSchedules() {
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const currentTime = now.toTimeString().slice(0, 5);
        
        return this.schedules.filter(schedule => {
            if (schedule.completed) return false;
            if (schedule.date < today) return false;
            if (schedule.date === today && schedule.endTime < currentTime) return false;
            return true;
        }).sort((a, b) => {
            const dateCompare = a.date.localeCompare(b.date);
            if (dateCompare !== 0) return dateCompare;
            return a.startTime.localeCompare(b.startTime);
        });
    }
}

const reminder = new ScheduleReminder();

// IPC 通信
ipcMain.handle('get-schedules', () => {
    return reminder.schedules;
});

ipcMain.handle('add-schedule', (event, schedule) => {
    reminder.addSchedule(schedule);
    return { success: true };
});

ipcMain.handle('update-schedule', (event, id, updatedSchedule) => {
    reminder.updateSchedule(id, updatedSchedule);
    return { success: true };
});

ipcMain.handle('delete-schedule', (event, id) => {
    reminder.deleteSchedule(id);
    return { success: true };
});

ipcMain.handle('get-upcoming-schedules', () => {
    return reminder.getUpcomingSchedules();
});

app.whenReady().then(createWindow);

// macOS 特殊处理：点击 Dock 图标时显示窗口
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    } else if (mainWindow) {
        mainWindow.show();
    }
});

// 保持应用在后台运行
app.on('window-all-closed', () => {
    // 不做任何事，保持应用运行
});

// 真正退出前的处理
app.on('before-quit', () => {
    isQuitting = true;
});
