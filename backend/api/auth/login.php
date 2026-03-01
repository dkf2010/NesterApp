<?php
// backend/api/auth/login.php
require_once dirname(__DIR__) . '/db.php';

$data = json_decode(file_get_contents('php://input'), true);

if (!isset($data['email']) || !isset($data['password'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Email and password required']);
    exit;
}

try {
    $stmt = $pdo->prepare("SELECT id, username, email, password_hash, is_admin FROM users WHERE email = ?");
    $stmt->execute([$data['email']]);
    $user = $stmt->fetch();

    if ($user && password_verify($data['password'], $user['password_hash'])) {
        // Generate Token
        $token = bin2hex(random_bytes(32));
        $tokenId = bin2hex(random_bytes(16));

        // Expiry set to 14 days (2 weeks)
        $expiresAt = (new DateTime())->modify('+14 days')->format('Y-m-d H:i:s');

        $insert = $pdo->prepare("INSERT INTO user_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)");
        $insert->execute([$tokenId, $user['id'], $token, $expiresAt]);

        echo json_encode([
            'success' => true,
            'token' => $token,
            'expires_at' => $expiresAt,
            'user' => [
                'username' => $user['username'],
                'is_admin' => (bool) $user['is_admin']
            ]
        ]);
    } else {
        http_response_code(401);
        echo json_encode(['error' => 'Invalid credentials']);
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>