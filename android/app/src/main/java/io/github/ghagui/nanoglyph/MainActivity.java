package io.github.ghagui.nanoglyph;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NanoGlyphMediaPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
