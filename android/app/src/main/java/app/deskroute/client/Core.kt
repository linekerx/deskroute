package app.deskroute.client

import android.content.Context
import android.os.Handler
import android.os.Looper
import libv2ray.Libv2ray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Общее состояние: ядро, события для интерфейса, фоновые задачи. */
object Core {
    @Volatile var status: String = "disconnected"
    @Volatile var error: String = ""
    @Volatile private var envReady = false
    private val main = Handler(Looper.getMainLooper())
    val pool = Executors.newFixedThreadPool(6)

    /** Куда отправлять события (MainActivity подставляет сюда WebView). */
    @Volatile var sink: ((String, String) -> Unit)? = null

    fun emit(type: String, payload: JSONObject) {
        val s = sink ?: return
        val json = payload.toString()
        main.post { s(type, json) }
    }

    fun log(text: String, level: String = "info") {
        emit("log", JSONObject().put("text", text).put("level", level))
    }

    fun setStatus(st: String, err: String = "") {
        status = st
        error = err
        emit("vpn", JSONObject().put("status", st).put("error", err))
    }

    /** Копирует гео-базы из ресурсов приложения и сообщает ядру, где их искать. */
    @Synchronized
    fun ensureEnv(ctx: Context) {
        if (envReady) return
        val dir = File(ctx.filesDir, "core")
        dir.mkdirs()
        val stamp = File(dir, ".version")
        val ver = ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: ""
        if (!stamp.exists() || stamp.readText() != ver) {
            for (name in listOf("geoip.dat", "geosite.dat")) {
                try {
                    ctx.assets.open(name).use { input -> File(dir, name).outputStream().use { input.copyTo(it) } }
                } catch (e: Exception) {
                    log("Не удалось скопировать $name: ${e.message}", "warning")
                }
            }
            stamp.writeText(ver)
        }
        Libv2ray.initCoreEnv(dir.absolutePath, "")
        envReady = true
    }

    fun coreVersion(): String = try {
        Libv2ray.checkVersionX()
    } catch (e: Throwable) {
        ""
    }

    /* ---------- статистика ---------- */

    @Volatile private var statsThread: Thread? = null

    fun startStats(port: Int) {
        stopStats()
        val t = Thread {
            while (!Thread.currentThread().isInterrupted) {
                try {
                    val c = URL("http://127.0.0.1:$port/debug/vars").openConnection() as HttpURLConnection
                    c.connectTimeout = 1500
                    c.readTimeout = 1500
                    val body = c.inputStream.bufferedReader().use { it.readText() }
                    c.disconnect()
                    val stats = JSONObject(body).optJSONObject("stats")
                    if (stats != null) emit("metrics", stats)
                } catch (_: Exception) {
                }
                try {
                    Thread.sleep(1000)
                } catch (_: InterruptedException) {
                    break
                }
            }
        }
        t.isDaemon = true
        statsThread = t
        t.start()
    }

    fun stopStats() {
        statsThread?.interrupt()
        statsThread = null
    }

    /* ---------- проверка задержки и загрузка подписок ---------- */

    fun measureDelay(ctx: Context, id: String, config: String, url: String) {
        pool.execute {
            val out = JSONObject().put("id", id)
            try {
                ensureEnv(ctx)
                val ms = Libv2ray.measureOutboundDelay(config, url)
                if (ms > 0) out.put("ms", ms) else out.put("error", "Нет ответа")
            } catch (e: Throwable) {
                out.put("error", (e.message ?: "Нет ответа").take(200))
            }
            emit("delay", out)
        }
    }

    fun httpGet(id: String, url: String, userAgent: String) {
        pool.execute {
            val out = JSONObject().put("id", id)
            try {
                var current = URL(url)
                var conn: HttpURLConnection
                var hops = 0
                while (true) {
                    conn = current.openConnection() as HttpURLConnection
                    conn.instanceFollowRedirects = false
                    conn.connectTimeout = 20000
                    conn.readTimeout = 25000
                    conn.setRequestProperty("User-Agent", userAgent)
                    conn.setRequestProperty("Accept", "*/*")
                    val code = conn.responseCode
                    if (code in 300..399 && hops < 6) {
                        val loc = conn.getHeaderField("Location") ?: break
                        current = URL(current, loc)
                        conn.disconnect()
                        hops++
                        continue
                    }
                    break
                }
                val code = conn.responseCode
                val stream = if (code >= 400) conn.errorStream else conn.inputStream
                val body = stream?.bufferedReader(Charsets.UTF_8)?.use { r ->
                    val sb = StringBuilder()
                    val buf = CharArray(8192)
                    while (sb.length < 16_000_000) {
                        val n = r.read(buf)
                        if (n < 0) break
                        sb.append(buf, 0, n)
                    }
                    sb.toString()
                } ?: ""
                val headers = JSONObject()
                for ((k, v) in conn.headerFields) {
                    if (k != null && v != null && v.isNotEmpty()) headers.put(k.lowercase(), v.joinToString(", "))
                }
                conn.disconnect()
                out.put("status", code).put("body", body).put("headers", headers)
            } catch (e: Exception) {
                out.put("error", e.message ?: e.javaClass.simpleName)
            }
            emit("http", out)
        }
    }
}
