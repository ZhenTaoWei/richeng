const { app, BrowserWindow, ipcMain, Notification, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let scheduleWindow;

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
        
        // 检查更新
        autoUpdater.checkForUpdatesAndNotify();
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
    const { Menu, Tray } = require('electron');
    
    const tray = new Tray(path.join(__dirname, 'assets/tray-icon.png'));
    
    const contextMenu = Menu.buildFromTemplate([
        {
            label: '显示主窗口',
            click: () => {
                mainWindow.show();
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
                app.quit();
            }
        }
    ]);
    
    tray.setToolTip('日程提醒助手');
    tray.setContextMenu(contextMenu);
    
    tray.on('click', () => {
        mainWindow.show();
    });
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
        const fs = require('fs');
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
        const fs = require('fs');
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
            icon: path.join(__dirname, 'assets/reminder-icon.png'),
            silent: false,
            timeoutType: 'never'
        });

        notification.on('click', () => {
            mainWindow.show();
            mainWindow.focus();
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

// 自动更新
autoUpdater.on('update-available', () => {
    dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '发现新版本',
        message: '发现新版本，是否现在更新？',
        buttons: ['是', '否']
    }).then((result) => {
        if (result.response === 0) {
            autoUpdater.downloadUpdate();
        }
    });
});

autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '更新就绪',
        message: '更新已下载完成，是否现在重启应用？',
        buttons: ['是', '否']
    }).then((result) => {
        if (result.response === 0) {
            autoUpdater.quitAndInstall();
        }
    });
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// 防止应用退出，保持后台运行
app.on('before-quit', (event) => {
    if (mainWindow) {
        event.preventDefault();
        mainWindow.hide();
    }
});