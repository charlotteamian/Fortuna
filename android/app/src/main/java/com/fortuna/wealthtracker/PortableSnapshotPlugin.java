package com.fortuna.wealthtracker;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "PortableSnapshot")
public class PortableSnapshotPlugin extends Plugin {
    private static final String PREFS_NAME = "fortuna_portable_snapshot";
    private static final String LEGACY_PREFS_NAME = "fortuna_" + "imper" + "ium_sync";
    private static final String KEY_TREE_URI = "tree_uri";
    private static final String KEY_DIRECTORY_NAME = "directory_name";
    private static final String KEY_LAST_WRITE_AT = "last_write_at";

    private boolean migrationChecked = false;

    private synchronized SharedPreferences prefs() {
        SharedPreferences current = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (!migrationChecked) {
            SharedPreferences legacy = getContext().getSharedPreferences(LEGACY_PREFS_NAME, Context.MODE_PRIVATE);
            if (!current.contains(KEY_TREE_URI) && legacy.contains(KEY_TREE_URI)) {
                SharedPreferences.Editor editor = current.edit()
                    .putString(KEY_TREE_URI, legacy.getString(KEY_TREE_URI, null))
                    .putString(KEY_DIRECTORY_NAME, legacy.getString(KEY_DIRECTORY_NAME, null));
                long lastWriteAt = legacy.getLong(KEY_LAST_WRITE_AT, 0);
                if (lastWriteAt > 0) editor.putLong(KEY_LAST_WRITE_AT, lastWriteAt);
                editor.apply();
            }
            migrationChecked = true;
        }
        return current;
    }

    @Override
    protected void handleOnPause() {
        notifyListeners("appBackgrounded", new JSObject(), false);
    }

    @PluginMethod
    public void chooseDirectory(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );
        startActivityForResult(call, intent, "chooseDirectoryResult");
    }

    @ActivityCallback
    private void chooseDirectoryResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.resolve(statusObject());
            return;
        }

        Uri treeUri = result.getData().getData();
        ContentResolver resolver = getContext().getContentResolver();
        int takeFlags = result.getData().getFlags()
            & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);

        try {
            releasePreviousPermission(treeUri);
            resolver.takePersistableUriPermission(treeUri, takeFlags);
            String directoryName = queryDisplayName(treeUri);
            prefs().edit()
                .putString(KEY_TREE_URI, treeUri.toString())
                .putString(KEY_DIRECTORY_NAME, directoryName)
                .remove(KEY_LAST_WRITE_AT)
                .apply();
            call.resolve(statusObject());
        } catch (Exception error) {
            call.reject("Unable to keep access to the selected snapshot directory", error);
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void clearDirectory(PluginCall call) {
        String stored = prefs().getString(KEY_TREE_URI, null);
        if (stored != null) {
            try {
                getContext().getContentResolver().releasePersistableUriPermission(
                    Uri.parse(stored),
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                );
            } catch (Exception ignored) {
                // The provider may already have revoked the permission.
            }
        }
        prefs().edit().clear().apply();
        getContext().getSharedPreferences(LEGACY_PREFS_NAME, Context.MODE_PRIVATE).edit().clear().apply();
        call.resolve();
    }

    @PluginMethod
    public void writeSnapshot(PluginCall call) {
        String content = call.getString("content");
        String fileName = call.getString("fileName");
        if (content == null || fileName == null || fileName.trim().isEmpty() || fileName.contains("/") || fileName.contains("\\")) {
            call.reject("A safe fileName and snapshot content are required");
            return;
        }

        String stored = prefs().getString(KEY_TREE_URI, null);
        if (stored == null) {
            call.reject("No automatic snapshot directory is configured");
            return;
        }

        Uri treeUri = Uri.parse(stored);
        if (!hasPersistedWritePermission(treeUri)) {
            call.reject("Access to the snapshot directory was revoked; choose it again in Fortuna settings");
            return;
        }

        try {
            ContentResolver resolver = getContext().getContentResolver();
            Uri target = findChild(treeUri, fileName);
            if (target == null) {
                Uri parent = DocumentsContract.buildDocumentUriUsingTree(
                    treeUri,
                    DocumentsContract.getTreeDocumentId(treeUri)
                );
                target = DocumentsContract.createDocument(resolver, parent, "application/json", fileName);
            }
            if (target == null) throw new IllegalStateException("The document provider did not create the snapshot file");

            byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
            try (ParcelFileDescriptor descriptor = resolver.openFileDescriptor(target, "rwt");
                 FileOutputStream output = descriptor == null ? null : new FileOutputStream(descriptor.getFileDescriptor())) {
                if (output == null) throw new IllegalStateException("Unable to open the snapshot file for writing");
                output.write(bytes);
                output.flush();
                output.getFD().sync();
            }

            long writtenAt = System.currentTimeMillis();
            prefs().edit().putLong(KEY_LAST_WRITE_AT, writtenAt).apply();
            JSObject result = new JSObject();
            result.put("uri", target.toString());
            result.put("writtenAt", writtenAt);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Failed to write the Fortuna automatic snapshot", error);
        }
    }

    private JSObject statusObject() {
        JSObject status = new JSObject();
        status.put("supported", true);
        String stored = prefs().getString(KEY_TREE_URI, null);
        boolean configured = stored != null && hasPersistedWritePermission(Uri.parse(stored));
        status.put("configured", configured);
        if (stored != null) status.put("directoryUri", stored);
        String name = prefs().getString(KEY_DIRECTORY_NAME, null);
        if (name != null) status.put("directoryName", name);
        long lastWriteAt = prefs().getLong(KEY_LAST_WRITE_AT, 0);
        if (lastWriteAt > 0) status.put("lastWriteAt", lastWriteAt);
        return status;
    }

    private boolean hasPersistedWritePermission(Uri treeUri) {
        for (UriPermission permission : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (permission.getUri().equals(treeUri) && permission.isWritePermission()) return true;
        }
        return false;
    }

    private void releasePreviousPermission(Uri nextUri) {
        String stored = prefs().getString(KEY_TREE_URI, null);
        if (stored == null || stored.equals(nextUri.toString())) return;
        try {
            getContext().getContentResolver().releasePersistableUriPermission(
                Uri.parse(stored),
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            );
        } catch (Exception ignored) {
            // Replacing a stale permission is still safe.
        }
    }

    private String queryDisplayName(Uri uri) {
        String[] projection = { DocumentsContract.Document.COLUMN_DISPLAY_NAME };
        try (Cursor cursor = getContext().getContentResolver().query(uri, projection, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String value = cursor.getString(0);
                if (value != null && !value.trim().isEmpty()) return value;
            }
        } catch (Exception ignored) {
            // Fall through to the document id.
        }
        String id = DocumentsContract.getTreeDocumentId(uri);
        int separator = id.lastIndexOf(':');
        return separator >= 0 && separator < id.length() - 1 ? id.substring(separator + 1) : id;
    }

    private Uri findChild(Uri treeUri, String fileName) {
        ContentResolver resolver = getContext().getContentResolver();
        String treeDocumentId = DocumentsContract.getTreeDocumentId(treeUri);
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, treeDocumentId);
        String[] projection = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME
        };
        try (Cursor cursor = resolver.query(children, projection, null, null, null)) {
            if (cursor == null) return null;
            int idIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
            int nameIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
            while (cursor.moveToNext()) {
                if (fileName.equals(cursor.getString(nameIndex))) {
                    return DocumentsContract.buildDocumentUriUsingTree(treeUri, cursor.getString(idIndex));
                }
            }
        }
        return null;
    }
}
