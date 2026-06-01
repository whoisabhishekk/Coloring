package com.wingo.strategy

import android.Manifest
import android.app.AlertDialog
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Build
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.ImageButton
import android.widget.ProgressBar
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var progressSpinner: ProgressBar
    private lateinit var btnSettings: ImageButton
    private lateinit var sharedPreferences: SharedPreferences
    
    private val PREFS_NAME = "WingoStrategyPrefs"
    private val KEY_SERVER_URL = "server_url"
    private val DEFAULT_URL = "http://192.168.31.106:8080"
    private val NOTIFICATION_PERMISSION_CODE = 101
    private val CHANNEL_ID = "WingoSignalsChannel"
    private var notificationId = 1

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Keep the screen on during monitoring
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Initialize UI components
        webView = findViewById(R.id.webview)
        progressSpinner = findViewById(R.id.progress_spinner)
        btnSettings = findViewById(R.id.btn_settings)
        
        sharedPreferences = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        
        // Setup Native Notification Channel
        createNotificationChannel()

        // Setup WebView
        setupWebView()

        // Load configured URL
        val savedUrl = sharedPreferences.getString(KEY_SERVER_URL, DEFAULT_URL) ?: DEFAULT_URL
        webView.loadUrl(savedUrl)

        // Settings Button Click Listener
        btnSettings.setOnClickListener {
            showUrlConfigDialog()
        }

        // Request notification permission for Android 13+
        requestNotificationPermission()
    }

    private fun setupWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.userAgentString = "Mozilla/5.0 (Linux; Android 10; WingoApp) AppleWebKit/537.36"

        // Register Javascript Notification Bridge
        webView.addJavascriptInterface(AndroidBridge(this), "AndroidBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                progressSpinner.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                progressSpinner.visibility = View.GONE
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    if (request?.isForMainFrame == true) {
                        Toast.makeText(
                            this@MainActivity,
                            "Error connecting to server. Is it running?",
                            Toast.LENGTH_LONG
                        ).show()
                        progressSpinner.visibility = View.GONE
                    }
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            // Can be expanded to handle web console logging inside Android Studio logcat
        }
    }

    private fun showUrlConfigDialog() {
        val currentUrl = sharedPreferences.getString(KEY_SERVER_URL, DEFAULT_URL) ?: DEFAULT_URL
        
        // Build beautiful configuration dialog
        val builder = AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
        builder.setTitle("🔧 Configure Server Connection")
        builder.setMessage("Enter the server URL of the dashboard running on your Mac. Make sure both devices are on the same Wi-Fi network!")

        val input = EditText(this)
        input.setText(currentUrl)
        input.setPadding(32, 16, 32, 16)
        builder.setView(input)

        builder.setPositiveButton("Connect") { dialog, _ ->
            var newUrl = input.text.toString().trim()
            if (newUrl.isNotEmpty()) {
                if (!newUrl.startsWith("http://") && !newUrl.startsWith("https://")) {
                    newUrl = "http://" + newUrl
                }
                
                // Save url to local settings
                sharedPreferences.edit().putString(KEY_SERVER_URL, newUrl).apply()
                
                Toast.makeText(this, "Connecting to: $newUrl", Toast.LENGTH_SHORT).show()
                webView.loadUrl(newUrl)
            }
            dialog.dismiss()
        }

        builder.setNegativeButton("Cancel") { dialog, _ ->
            dialog.cancel()
        }

        builder.show()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val name = "Wingo Strategy Signals"
            val descriptionText = "Triggers real-time alerts when color prediction signals are active."
            val importance = NotificationManager.IMPORTANCE_HIGH
            val channel = NotificationChannel(CHANNEL_ID, name, importance).apply {
                description = descriptionText
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 250, 100, 250, 100, 250) // Triple pulse
            }
            // Register channel with system
            val notificationManager: NotificationManager =
                getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.POST_NOTIFICATIONS
                ) != PackageManager.PERMISSION_GRANTED
            ) {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    NOTIFICATION_PERMISSION_CODE
                )
            }
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == NOTIFICATION_PERMISSION_CODE) {
            if ((grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED)) {
                Toast.makeText(this, "🔔 Notifications Enabled!", Toast.LENGTH_SHORT).show()
            } else {
                Toast.makeText(
                    this,
                    "⚠️ Alerts disabled. Notifications are recommended for signal tracking.",
                    Toast.LENGTH_LONG
                ).show()
            }
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            // Double check before exit
            AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("Exit Wingo Strategy?")
                .setMessage("Are you sure you want to stop monitoring colors?")
                .setPositiveButton("Yes") { _, _ -> super.onBackPressed() }
                .setNegativeButton("No", null)
                .show()
        }
    }

    /**
     * JavaScript Bridge Interface
     */
    inner class AndroidBridge(private val context: Context) {
        
        @JavascriptInterface
        fun showNotification(title: String, message: String) {
            // Verify notification permissions
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.POST_NOTIFICATIONS
                ) != PackageManager.PERMISSION_GRANTED
            ) {
                return
            }

            // Launch MainActivity when notification clicked
            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            
            val pendingIntent = PendingIntent.getActivity(
                context,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            // Build native Android notification
            val builder = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.app_icon) // Uses our premium icon
                .setContentTitle(title)
                .setContentText(message)
                .setStyle(NotificationCompat.BigTextStyle().bigText(message))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setVibrate(longArrayOf(0, 300, 150, 300, 150, 300)) // Highly noticeable vibration

            with(NotificationManagerCompat.from(context)) {
                notify(notificationId++, builder.build())
            }
        }
    }
}
