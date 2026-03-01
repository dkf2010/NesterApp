<?php
// backend/create_admin.php
// Usage: Run this script ONCE from the command line or browser to create the initial user.
// Then delete this file for security.

require_once 'api/db.php';

// You can change these values in your .env file
$username = get_config('ADMIN_USER');
$email = get_config('ADMIN_EMAIL');
$password = get_config('ADMIN_PASSWORD');

try {
    $id = bin2hex(random_bytes(18)); // 36 chars
    $hash = password_hash($password, PASSWORD_DEFAULT);

    $stmt = $pdo->prepare("INSERT INTO users (id, username, email, password_hash, is_admin) VALUES (?, ?, ?, ?, 1)");
    $stmt->execute([$id, $username, $email, $hash]);

    echo "Admin user '$username' created successfully. You can now log in with password '$password'.\n";
    echo "IMPORTANT: Please delete this file (create_admin.php) now!\n";

} catch (PDOException $e) {
    if ($e->getCode() == 23000) { // Integrity constraint violation (duplicate)
        // If the user exists, ensure they are an admin
        $upd = $pdo->prepare("UPDATE users SET is_admin = 1 WHERE username = ?");
        $upd->execute([$username]);
        echo "User '$username' already exists. They have been granted admin privileges.\n";
    } else {
        echo "Database error: " . $e->getMessage() . "\n";
    }
}
?>