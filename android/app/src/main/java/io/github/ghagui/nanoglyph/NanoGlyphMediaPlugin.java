package io.github.ghagui.nanoglyph;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.OutputStream;

@CapacitorPlugin(
    name = "NanoGlyphMedia",
    permissions = {
        @Permission(
            alias = "legacyStorage",
            strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }
        )
    }
)
public class NanoGlyphMediaPlugin extends Plugin {
    @PluginMethod
    public void savePng(PluginCall call) {
        if (
            Build.VERSION.SDK_INT <= Build.VERSION_CODES.P &&
            getPermissionState("legacyStorage") != PermissionState.GRANTED
        ) {
            requestPermissionForAlias("legacyStorage", call, "storagePermissionCallback");
            return;
        }
        writePng(call);
    }

    @PermissionCallback
    private void storagePermissionCallback(PluginCall call) {
        if (getPermissionState("legacyStorage") == PermissionState.GRANTED) {
            writePng(call);
        } else {
            call.reject("Storage permission is required to save the PNG on Android 7–9.");
        }
    }

    private void writePng(PluginCall call) {
        String encoded = call.getString("data");
        String requestedName = call.getString("filename", "nanoglyph-image.png");
        if (encoded == null || encoded.isEmpty()) {
            call.reject("PNG data is empty.");
            return;
        }

        String filename = requestedName.replaceAll("[^A-Za-z0-9._-]", "_");
        if (!filename.toLowerCase().endsWith(".png")) filename += ".png";

        byte[] png;
        try {
            png = Base64.decode(encoded, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            call.reject("PNG data is not valid base64.", error);
            return;
        }

        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, filename);
        values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            values.put(
                MediaStore.Images.Media.RELATIVE_PATH,
                Environment.DIRECTORY_PICTURES + "/NanoGlyph"
            );
            values.put(MediaStore.Images.Media.IS_PENDING, 1);
        } else {
            File directory = new File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES),
                "NanoGlyph"
            );
            if (!directory.exists() && !directory.mkdirs()) {
                call.reject("Could not create the NanoGlyph gallery directory.");
                return;
            }
            values.put(MediaStore.Images.Media.DATA, new File(directory, filename).getAbsolutePath());
        }

        Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) {
            call.reject("Android MediaStore could not create the PNG.");
            return;
        }

        try (OutputStream stream = resolver.openOutputStream(uri, "w")) {
            if (stream == null) throw new IllegalStateException("MediaStore returned no output stream.");
            stream.write(png);
            stream.flush();

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues completed = new ContentValues();
                completed.put(MediaStore.Images.Media.IS_PENDING, 0);
                resolver.update(uri, completed, null, null);
            }

            JSObject result = new JSObject();
            result.put("uri", uri.toString());
            call.resolve(result);
        } catch (Exception error) {
            resolver.delete(uri, null, null);
            call.reject("Could not write the PNG to the gallery.", error);
        }
    }
}
