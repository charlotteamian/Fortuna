package com.fortuna.wealthtracker;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PortableSnapshotPlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
        super.onCreate(savedInstanceState);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            private boolean checkingReader = false;

            @Override
            public void handleOnBackPressed() {
                if (checkingReader) return;
                WebView webView = getBridge() == null ? null : getBridge().getWebView();
                if (webView == null) {
                    dispatchDefaultBack();
                    return;
                }
                checkingReader = true;
                webView.evaluateJavascript(
                    "(function() {"
                        + "if (window.location.hash !== '#/dividend/advice') return false;"
                        + "if (window.history.state && window.history.state.fortunaDividendReader === true && window.history.length > 1) {"
                        + "window.history.back();"
                        + "} else {"
                        + "var address = new URL(window.location.href); address.hash = '';"
                        + "window.history.replaceState(window.history.state, '', address.href);"
                        + "window.dispatchEvent(new HashChangeEvent('hashchange'));"
                        + "} return true;"
                        + "})()",
                    handled -> {
                        checkingReader = false;
                        if (!isFinishing() && !isDestroyed() && !"true".equals(handled)) dispatchDefaultBack();
                    }
                );
            }

            private void dispatchDefaultBack() {
                setEnabled(false);
                try {
                    getOnBackPressedDispatcher().onBackPressed();
                } finally {
                    setEnabled(true);
                }
            }
        });
    }
}
