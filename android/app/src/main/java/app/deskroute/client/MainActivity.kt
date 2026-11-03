package app.deskroute.client

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

class MainActivity : Activity() {

    private lateinit var web: WebView
    private var pendingConfig: String? = null
    @Volatile private var pendingText: String? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#0F1730"))
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowContentAccess = false
            textZoom = 100
        }
        web.addJavascriptInterface(Bridge(), "DRNative")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                if (u.scheme == "file") return false
                openUrl(u.toString())
                return true
            }
        }
        setContentView(web)
        Core.sink = { type, json -> web.evaluateJavascript("window.__drNative && window.__drNative(${JSONObject.quote(type)}, $json)", null) }
        Core.pool.execute { Core.ensureEnv(applicationContext) }
        handleIntent(intent)
        web.loadUrl("file:///android_asset/www/index.html")
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 2)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
        pendingText?.let { t ->
            pendingText = null
            Core.emit("link", JSONObject().put("text", t))
        }
    }

    private fun handleIntent(i: Intent?) {
        if (i == null) return
        val text = when (i.action) {
            Intent.ACTION_VIEW -> i.dataString
            Intent.ACTION_SEND -> i.getStringExtra(Intent.EXTRA_TEXT)
            else -> null
        }
        if (!text.isNullOrBlank()) pendingText = text.trim()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        web.evaluateJavascript("(window.__drBack && window.__drBack()) ? 'yes' : 'no'") { r ->
            if (r?.contains("yes") != true) moveTaskToBack(true)
        }
    }

    override fun onDestroy() {
        Core.sink = null
        web.destroy()
        super.onDestroy()
    }

    /* ---------- VPN ---------- */

    private fun startVpn(config: String) {
        val prep = VpnService.prepare(this)
        if (prep != null) {
            pendingConfig = config
            try {
                startActivityForResult(prep, REQ_VPN)
            } catch (e: Exception) {
                Core.setStatus("error", "Не удалось запросить разрешение на VPN: ${e.message}")
            }
        } else {
            launchService(config)
        }
    }

    private fun launchService(config: String) {
        val i = Intent(this, DRVpnService::class.java).setAction(DRVpnService.ACTION_START).putExtra(DRVpnService.EXTRA_CONFIG, config)
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(i) else startService(i)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_VPN) {
            val cfg = pendingConfig
            pendingConfig = null
            if (resultCode == RESULT_OK && cfg != null) launchService(cfg)
            else Core.setStatus("error", "Без разрешения на VPN подключиться нельзя. Нажмите на кольцо ещё раз и разрешите.")
        }
    }

    private fun openUrl(url: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {
        }
    }

    /* ---------- мост для интерфейса ---------- */

    inner class Bridge {
        @JavascriptInterface
        fun startVpn(config: String) = runOnUiThread { this@MainActivity.startVpn(config) }

        @JavascriptInterface
        fun stopVpn() = runOnUiThread {
            startService(Intent(this@MainActivity, DRVpnService::class.java).setAction(DRVpnService.ACTION_STOP))
        }

        @JavascriptInterface
        fun vpnStatus(): String = JSONObject().put("status", if (DRVpnService.running) "connected" else Core.status).put("error", Core.error).toString()

        @JavascriptInterface
        fun startStats(port: Int) = Core.startStats(port)

        @JavascriptInterface
        fun stopStats() = Core.stopStats()

        @JavascriptInterface
        fun measureDelay(id: String, config: String, url: String) = Core.measureDelay(applicationContext, id, config, url)

        @JavascriptInterface
        fun httpGet(id: String, url: String, userAgent: String) = Core.httpGet(id, url, userAgent)

        @JavascriptInterface
        fun readClipboard(): String {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = cm.primaryClip ?: return ""
            return if (clip.itemCount > 0) clip.getItemAt(0).coerceToText(this@MainActivity).toString() else ""
        }

        @JavascriptInterface
        fun copyText(text: String) = runOnUiThread {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("DeskRoute", text))
        }

        @JavascriptInterface
        fun openUrl(url: String) = runOnUiThread { this@MainActivity.openUrl(url) }

        @JavascriptInterface
        fun openVpnSettings() = runOnUiThread {
            try {
                startActivity(Intent(Settings.ACTION_VPN_SETTINGS))
            } catch (_: Exception) {
            }
        }

        @JavascriptInterface
        fun share(text: String) = runOnUiThread {
            val i = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
            startActivity(Intent.createChooser(i, "Поделиться"))
        }

        @JavascriptInterface
        fun takeIntentText(): String {
            val t = pendingText ?: ""
            pendingText = null
            return t
        }

        @JavascriptInterface
        fun appInfo(): String = JSONObject()
            .put("version", packageManager.getPackageInfo(packageName, 0).versionName)
            .put("core", Core.coreVersion())
            .put("sdk", Build.VERSION.SDK_INT)
            .toString()

        @JavascriptInterface
        fun setBars(color: String, light: Boolean) = runOnUiThread {
            try {
                val c = Color.parseColor(color)
                window.statusBarColor = c
                window.navigationBarColor = c
                var flags = window.decorView.systemUiVisibility
                flags = if (light) flags or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR else flags and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
                if (Build.VERSION.SDK_INT >= 26) {
                    flags = if (light) flags or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR else flags and View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR.inv()
                }
                window.decorView.systemUiVisibility = flags
                web.setBackgroundColor(c)
            } catch (_: Exception) {
            }
        }
    }

    companion object {
        private const val REQ_VPN = 1
    }
}
