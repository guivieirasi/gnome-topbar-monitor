import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Cairo from 'gi://cairo';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

function readFile(path) {
    try {
        let [ok, contents] = GLib.file_get_contents(path);
        if (ok)
            return new TextDecoder('utf-8').decode(contents);
    } catch (e) {}
    return null;
}


class MiniGraph {
    constructor(width = 60, height = 14, columns = 40, color = [0, 0.8, 1]) {
        this.width = width;
        this.height = height;
        this.columns = columns;
        this.color = color;

        this.history = Array(columns).fill(0);

        this.actor = new St.DrawingArea({
            width: this.width,
            style: `height: ${this.height}px;`
        });

        this.actor.y_align = Clutter.ActorAlign.CENTER;

        this.actor.connect('repaint', area => {
            this._draw(area);
        });
    }

    addValue(percent) {
        const last = this.history[this.history.length - 1];

        const smoothed = last * 0.7 + percent * 0.3;

        this.history.shift();
        this.history.push(smoothed);

        this.actor.queue_repaint();
    }

    _draw(area) {
        const cr = area.get_context();
        const themeNode = area.get_theme_node();
        const [width, height] = area.get_surface_size();

        cr.setSourceRGBA(0, 0, 0, 0);
        cr.setOperator(Cairo.Operator.SOURCE);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);

        cr.setSourceRGBA(...this.color, 1);

        const barWidth = width / this.columns;

        for (let i = 0; i < this.columns; i++) {
            const value = this.history[i] / 100;
            const barHeight = value * height;

            cr.rectangle(
                i * barWidth,
                height - barHeight,
                barWidth - 0.3,
                barHeight
            );
            cr.fill();
        }
    }
}

const SystemIndicator = GObject.registerClass(
class SystemIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'System Monitor');

        this.mainBox = new St.BoxLayout({
            vertical: false,
            style_class: 'panel-button',
            y_align: Clutter.ActorAlign.CENTER
        });

        const labelClass = 'system-monitor-label';

        /* ===== RAM ===== */

        this.ramText = new St.Label({ style_class: labelClass });
        this.ramText.y_align = Clutter.ActorAlign.CENTER;

        this.ramGraph = new MiniGraph(60, 16, 40, [0.74, 0.07, 0.99]);

        const ramInner = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER
        });

        ramInner.add_child(this.ramText);
        ramInner.add_child(this.ramGraph.actor);

        this.ramBox = new St.Button({
            child: ramInner,
            style_class: 'system-monitor-clickable',
            reactive: true,
            can_focus: true,
            track_hover: true
        });

        this.ramBox.connect('clicked', () => this._openSystemMonitor());

        /* ===== CPU ===== */

        this.cpuText = new St.Label({ style_class: labelClass });
        this.cpuText.y_align = Clutter.ActorAlign.CENTER;

        this.cpuGraph = new MiniGraph(60, 16, 40, [0, 0.83, 1]);

        const cpuInner = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER
        });

        cpuInner.add_child(this.cpuText);
        cpuInner.add_child(this.cpuGraph.actor);

        this.cpuBox = new St.Button({
            child: cpuInner,
            style_class: 'system-monitor-clickable',
            reactive: true,
            can_focus: true,
            track_hover: true
        });

        this.cpuBox.connect('clicked', () => this._openSystemMonitor());

        /* ===== TEMP ===== */

        this.tempLabel = new St.Label({
            style_class: labelClass
        });

        /* ===== IP ===== */

        this.ipLabel = new St.Label({
            style_class: labelClass,
            text: 'IP: Localizando...'
        });

        this.ramText.y_align = Clutter.ActorAlign.CENTER;
        this.cpuText.y_align = Clutter.ActorAlign.CENTER;
        this.tempLabel.y_align = Clutter.ActorAlign.CENTER;
        this.ipLabel.y_align = Clutter.ActorAlign.CENTER;

        this.ipButton = new St.Button({
            child: this.ipLabel,
            style_class: 'system-monitor-ip-button',
            reactive: true,
            can_focus: true,
            track_hover: true
        });

        this.ipButton.connect('clicked', () => this._updateIp(true));

        this.mainBox.add_child(this.ramBox);
        this.mainBox.add_child(this.cpuBox);
        this.mainBox.add_child(this.ipButton);
        this.mainBox.add_child(this.tempLabel);

        this.add_child(this.mainBox);

        this._prevCpu = { idle: 0, total: 0 };

        this._updateIp(false);

        this._updateId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._updateData();
            return GLib.SOURCE_CONTINUE;
        });

        this._ipUpdateId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3600, () => {
            this._updateIp(false);
            return GLib.SOURCE_CONTINUE;
        });
    }

    _openSystemMonitor() {
        const app = Gio.AppInfo.create_from_commandline(
            'gnome-system-monitor',
            null,
            Gio.AppInfoCreateFlags.NONE
        );

        app.launch([], null);
    }

    _updateIp(copyToClipboard = false) {
        try {
            let routeData = readFile('/proc/net/route');
            let foundIp = null;

            if (routeData) {
                let lines = routeData.split('\n');
                for (let i = 1; i < lines.length; i++) {
                    let parts = lines[i].trim().split(/\s+/);
                    if (parts.length >= 8 && parts[0] !== 'lo') {
                        let [ok, out] = GLib.spawn_command_line_sync(`ip -4 addr show ${parts[0]}`);
                        if (ok) {
                            let match = new TextDecoder('utf-8')
                                .decode(out)
                                .match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
                            if (match) {
                                foundIp = match[1];
                                break;
                            }
                        }
                    }
                }
            }

            if (foundIp) {
                this.ipLabel.set_text(`IP: ${foundIp}`);
                if (copyToClipboard) {
                    St.Clipboard.get_default().set_text(
                        St.ClipboardType.CLIPBOARD,
                        foundIp
                    );
                    Main.notify('IP copied!', foundIp);
                }
            } else {
                this.ipLabel.set_text(`IP: Offline`);
            }

        } catch (e) {
            this.ipLabel.set_text(`IP: Erro`);
        }
    }

    _updateData() {

        let meminfo = readFile('/proc/meminfo');
        if (meminfo) {
            let total = parseInt(meminfo.match(/MemTotal:\s+(\d+)/)[1]);
            let avail = parseInt(meminfo.match(/MemAvailable:\s+(\d+)/)[1]);
            let usedP = ((total - avail) / total) * 100;

            this.ramText.set_text(`RAM ${usedP.toFixed(0)}%`);
            this.ramGraph.addValue(usedP);
        }


        let stat = readFile('/proc/stat');
        if (stat) {
            let cpuData = stat.split('\n')[0]
                .match(/cpu\s+(.+)/)[1]
                .trim()
                .split(/\s+/)
                .map(Number);

            let idle = cpuData[3];
            let total = cpuData.reduce((a, b) => a + b, 0);

            let diffTotal = total - this._prevCpu.total;
            let usage = diffTotal > 0
                ? (1 - ((idle - this._prevCpu.idle) / diffTotal)) * 100
                : 0;

            this._prevCpu = { idle, total };

            this.cpuText.set_text(`CPU ${usage.toFixed(0)}%`);
            this.cpuGraph.addValue(usage);
        }


        let temp = readFile('/sys/class/thermal/thermal_zone0/temp');
        if (temp) {
            this.tempLabel.set_text(
                `Temp: ${(parseInt(temp) / 1000).toFixed(0)}°C`
            );
        }
    }

    destroy() {
        if (this._updateId)
            GLib.source_remove(this._updateId);

        if (this._ipUpdateId)
            GLib.source_remove(this._ipUpdateId);

        super.destroy();
    }
});

export default class IndicatorExampleExtension extends Extension {
    enable() {
        this._indicator = new SystemIndicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator, 1, 'right');

        this._indicator.style = 'margin-right: 30px;';
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}