<?php
// backend/api/delete_nest_photo.php
require_once 'db.php';
require_once 'auth/auth_util.php';

$user_id = require_auth($pdo);

$data = json_decode(file_get_contents('php://input'), true);

if (!isset($data['id'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing nest id']);
    exit;
}

try {
    // Fetch current photo to delete it if exists
    $stmt = $pdo->prepare("SELECT photo_filename FROM taubennester WHERE id = ?");
    $stmt->execute([$data['id']]);
    $nest = $stmt->fetch();

    if ($nest && $nest['photo_filename']) {
        $uploadDir = __DIR__ . '/../uploads/nests/';
        $oldFilePath = $uploadDir . $nest['photo_filename'];
        if (file_exists($oldFilePath)) {
            unlink($oldFilePath);
        }

        // Update database to remove photo
        $updateStmt = $pdo->prepare("UPDATE taubennester SET photo_filename = NULL WHERE id = ?");
        $updateStmt->execute([$data['id']]);

        // Add log entry
        $logId = bin2hex(random_bytes(18));
        $actionText = 'Foto gelöscht';
        $createdAt = date('Y-m-d H:i:s');

        $logStmt = $pdo->prepare("INSERT INTO taubennest_logs (id, nest_id, user_id, action, timestamp) VALUES (?, ?, ?, ?, ?)");
        $logStmt->execute([
            $logId,
            $data['id'],
            $user_id['id'],
            $actionText,
            $createdAt
        ]);

        echo json_encode(['success' => true]);
    } else {
        http_response_code(404);
        echo json_encode(['error' => 'No photo found for this nest']);
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>