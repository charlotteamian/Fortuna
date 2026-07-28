package com.fortuna.wealthtracker;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PortableSnapshotPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
