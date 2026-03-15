<?php
// backend/api/auth/create_user.php
require_once dirname(__DIR__) . '/db.php';
require_once 'auth_util.php';
require_once dirname(__DIR__) . '/app_logger.php';

// Only logged in admins can create new users
$currentUser = require_auth($pdo);

if (!$currentUser['is_admin']) {
    http_response_code(403);
    echo json_encode(['error' => 'Forbidden: Only administrators can create users.']);
    exit;
}

$data = json_decode(file_get_contents('php://input'), true);

if (!isset($data['username']) || !isset($data['email'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Username and email are required']);
    exit;
}

try {
    $id = bin2hex(random_bytes(18)); // 36 chars
    $email = $data['email'];
    $username = $data['username'];

    // Generate a strong random unusable placeholder password
    $placeholderHash = password_hash(bin2hex(random_bytes(32)), PASSWORD_DEFAULT);

    // Insert new user
    $stmt = $pdo->prepare("INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)");
    $stmt->execute([$id, $username, $email, $placeholderHash]);

    // Generate a setup token (same as forgot password)
    $token = bin2hex(random_bytes(32));
    $tokenId = bin2hex(random_bytes(16));
    $expiresAt = (new DateTime())->modify('+7 days')->format('Y-m-d H:i:s'); // Give them a week to set it up

    $insertToken = $pdo->prepare("INSERT INTO password_resets (id, email, token, expires_at) VALUES (?, ?, ?, ?)");
    $insertToken->execute([$tokenId, $email, $token, $expiresAt]);

    // Send setup email
    $domain = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : get_config('APP_URL');
    $setupLink = $domain . "/?reset_token=" . $token;

    $subject = "Willkommen bei der NesterApp";
    $message = "Hallo $username,\n\nein neues Konto wurde für Sie in der NesterApp angelegt.\nBitte klicken Sie auf den folgenden Link, um ein eigenes Passwort zu vergeben und Ihr Konto zu aktivieren:\n\n" . $setupLink . "\n\n(Dieser Link ist für 7 Tage gültig.)";
    $mailFrom = get_config('MAIL_FROM_ADDRESS');
    $headers = "From: " . $mailFrom . "\r\n" .
        "Reply-To: " . $mailFrom . "\r\n" .
        "X-Mailer: PHP/" . phpversion();

    mail($email, $subject, $message, $headers);

    app_log($pdo, 'info', 'auth/create_user', "Neuer Benutzer angelegt: {$username}", [
        'new_user_email' => $email
    ], $currentUser['id']);

    echo json_encode(['success' => true]);
} catch (PDOException $e) {
    if ($e->getCode() == 23000) {
        app_log($pdo, 'warning', 'auth/create_user', "Benutzer konnte nicht angelegt werden (Duplikat): {$username}", [
            'email' => $data['email'] ?? ''
        ], $currentUser['id']);
        http_response_code(400);
        echo json_encode(['error' => 'Username or Email already exists.']);
    } else {
        app_log($pdo, 'error', 'auth/create_user', 'DB-Fehler beim Anlegen eines Benutzers', [
            'exception' => $e->getMessage()
        ], $currentUser['id']);
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }
}
?>