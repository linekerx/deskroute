package app.deskroute.client

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import libv2ray.CoreCallbackHandler
import libv2ray.CoreController
import libv2ray.Libv2ray
import java.io.File

/** VPN-сервис: создаёт TUN-интерфейс и передаёт его ядру Xray. */
class DRVpnService : VpnService(), CoreCallbackHandler {

    private var tun: ParcelFileDescriptor? = null
    private var controller: CoreController? = null
    private val lock = Any()

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                Thread { stopAll(true) }.start()
            }
            ACTION_START -> {
                val cfg = intent.getStringExtra(EXTRA_CONFIG) ?: lastConfigFile(this).takeIf { it.exists() }?.readText()
                if (cfg == null) {
                    stopSelf()
                    return START_NOT_STICKY
                }
                lastConfigFile(this).writeText(cfg)
                startForegroundCompat(getString(R.string.connecting))
                Thread { start(cfg) }.start()
            }
            else -> {
                // запуск системой (постоянный VPN): берём последний конфиг
                val f = lastConfigFile(this)
                if (f.exists()) {
                    startForegroundCompat(getString(R.string.connecting))
                    val cfg = f.readText()
                    Thread { start(cfg) }.start()
                } else {
                    stopSelf()
                }
            }
        }
        return START_STICKY
    }

    private fun start(cfg: String) {
        synchronized(lock) {
            try {
                Core.setStatus("connecting")
                stopCore()
                Core.ensureEnv(this)
                val b = Builder()
                    .setSession("DeskRoute")
                    .setMtu(1500)
                    .addAddress("10.10.14.1", 30)
                    .addRoute("0.0.0.0", 0)
                    .addDnsServer("1.1.1.1")
                try {
                    b.addAddress("fd66:6464:7273::1", 126)
                    b.addRoute("::", 0)
                } catch (_: Exception) {
                }
                try {
                    b.addDisallowedApplication(packageName)
                } catch (_: Exception) {
                }
                if (Build.VERSION.SDK_INT >= 29) b.setMetered(false)
                b.setConfigureIntent(openAppIntent())
                val fd = b.establish() ?: throw IllegalStateException("Android не дал создать VPN. Проверьте, что DeskRoute разрешено работать как VPN.")
                tun = fd
                val c = Libv2ray.newCoreController(this)
                c.startLoop(cfg, fd.fd)
                controller = c
                running = true
                updateNotification(getString(R.string.connected))
                Core.setStatus("connected")
            } catch (e: Throwable) {
                Core.log("Ошибка запуска VPN: ${e.message}", "error")
                stopCore()
                running = false
                Core.setStatus("error", e.message ?: "Не удалось запустить VPN")
                stopForegroundCompat()
                stopSelf()
            }
        }
    }

    private fun stopCore() {
        Core.stopStats()
        try {
            controller?.stopLoop()
        } catch (_: Throwable) {
        }
        controller = null
        try {
            tun?.close()
        } catch (_: Throwable) {
        }
        tun = null
    }

    private fun stopAll(byUser: Boolean) {
        synchronized(lock) {
            stopCore()
            running = false
            if (byUser) lastConfigFile(this).delete()
            Core.setStatus("disconnected")
            stopForegroundCompat()
            stopSelf()
        }
    }

    override fun onRevoke() {
        Core.log("VPN отключён системой или другим приложением", "warning")
        Thread { stopAll(false) }.start()
    }

    override fun onDestroy() {
        synchronized(lock) { stopCore() }
        running = false
        super.onDestroy()
    }

    /* ---------- колбэки ядра ---------- */

    override fun startup(): Long = 0

    override fun shutdown(): Long = 0

    override fun onEmitStatus(p0: Long, p1: String?): Long {
        if (!p1.isNullOrBlank()) Core.log(p1)
        return 0
    }

    /* ---------- уведомление ---------- */

    private fun openAppIntent(): PendingIntent =
        PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    private fun buildNotification(text: String): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val b = if (Build.VERSION.SDK_INT >= 26) {
            if (nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(NotificationChannel(CHANNEL, "VPN", NotificationManager.IMPORTANCE_LOW))
            }
            Notification.Builder(this, CHANNEL)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        val stop = PendingIntent.getService(this, 1, Intent(this, DRVpnService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return b.setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("DeskRoute")
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(openAppIntent())
            .addAction(Notification.Action.Builder(null, getString(R.string.disconnect), stop).build())
            .build()
    }

    private fun startForegroundCompat(text: String) {
        startForeground(NOTIFICATION_ID, buildNotification(text))
    }

    private fun updateNotification(text: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
    }

    companion object {
        const val ACTION_START = "app.deskroute.client.START"
        const val ACTION_STOP = "app.deskroute.client.STOP"
        const val EXTRA_CONFIG = "config"
        private const val CHANNEL = "vpn"
        private const val NOTIFICATION_ID = 1

        @Volatile var running = false

        fun lastConfigFile(ctx: Context) = File(ctx.filesDir, "last-config.json")
    }
}
