<?php
// backend/api/upload_nest_photo.php
require_once 'db.php';
require_once 'auth/auth_util.php';
require_once 'app_logger.php';

$currentUser = require_auth($pdo);

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

if (!isset($_POST['id'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing nest ID']);
    exit;
}

$nestId = $_POST['id'];

if (!isset($_FILES['photo']) || $_FILES['photo']['error'] !== UPLOAD_ERR_OK) {
    http_response_code(400);
    echo json_encode(['error' => 'No photo uploaded or upload error']);
    exit;
}

$photo = $_FILES['photo'];
$allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

if (!in_array($photo['type'], $allowedTypes)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid file type. Only JPG, PNG, and WebP are allowed.']);
    exit;
}

// Ensure upload directory exists
$uploadDir = __DIR__ . '/../uploads/nests/';
if (!is_dir($uploadDir)) {
    mkdir($uploadDir, 0755, true);
}

// Generate a unique filename
$extension = pathinfo($photo['name'], PATHINFO_EXTENSION);
// If no extension could be determined from name, try to guess from mime type
if (!$extension) {
    $mimeToExt = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp'
    ];
    $extension = $mimeToExt[$photo['type']] ?? 'jpg';
}

$filename = uniqid('nest_' . $nestId . '_') . '.' . $extension;
$destination = $uploadDir . $filename;

$maxWidth = 1280;
$maxHeight = 1280;

$imageInfo = getimagesize($photo['tmp_name']);
if (!$imageInfo) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid image file']);
    exit;
}
list($origWidth, $origHeight, $imageType) = $imageInfo;

// Calculate new dimensions
$ratio = $origWidth / $origHeight;
$newWidth = $origWidth;
$newHeight = $origHeight;

if ($origWidth > $maxWidth || $origHeight > $maxHeight) {
    if ($maxWidth / $maxHeight > $ratio) {
        $newWidth = $maxHeight * $ratio;
        $newHeight = $maxHeight;
    } else {
        $newHeight = $maxWidth / $ratio;
        $newWidth = $maxWidth;
    }
}

// Ensure dimensions are integers
$newWidth = (int) $newWidth;
$newHeight = (int) $newHeight;

// Create source image
$sourceImage = null;
switch ($imageType) {
    case IMAGETYPE_JPEG:
        $sourceImage = imagecreatefromjpeg($photo['tmp_name']);

        // Handle EXIF orientation
        if ($sourceImage && function_exists('exif_read_data')) {
            $exif = @exif_read_data($photo['tmp_name']);
            if ($exif && isset($exif['Orientation'])) {
                switch ($exif['Orientation']) {
                    case 3:
                        $sourceImage = imagerotate($sourceImage, 180, 0);
                        break;
                    case 6:
                        $sourceImage = imagerotate($sourceImage, -90, 0);
                        // Swap dimensions for correct resizing later
                        $temp = $origWidth;
                        $origWidth = $origHeight;
                        $origHeight = $temp;
                        break;
                    case 8:
                        $sourceImage = imagerotate($sourceImage, 90, 0);
                        // Swap dimensions for correct resizing later
                        $temp = $origWidth;
                        $origWidth = $origHeight;
                        $origHeight = $temp;
                        break;
                }

                // Recalculate dimensions since orientation might have swapped width/height
                $ratio = $origWidth / $origHeight;
                $newWidth = $origWidth;
                $newHeight = $origHeight;

                if ($origWidth > $maxWidth || $origHeight > $maxHeight) {
                    if ($maxWidth / $maxHeight > $ratio) {
                        $newWidth = $maxHeight * $ratio;
                        $newHeight = $maxHeight;
                    } else {
                        $newHeight = $maxWidth / $ratio;
                        $newWidth = $maxWidth;
                    }
                }
                $newWidth = (int) $newWidth;
                $newHeight = (int) $newHeight;
            }
        }
        break;
    case IMAGETYPE_PNG:
        $sourceImage = imagecreatefrompng($photo['tmp_name']);
        break;
    case IMAGETYPE_WEBP:
        $sourceImage = imagecreatefromwebp($photo['tmp_name']);
        break;
    default:
        http_response_code(400);
        echo json_encode(['error' => 'Unsupported image format for processing']);
        exit;
}

if (!$sourceImage) {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to process image']);
    exit;
}

$newImage = imagecreatetruecolor($newWidth, $newHeight);

// Preserve transparency for PNG and WebP
if ($imageType == IMAGETYPE_PNG || $imageType == IMAGETYPE_WEBP) {
    imagealphablending($newImage, false);
    imagesavealpha($newImage, true);
    $transparent = imagecolorallocatealpha($newImage, 255, 255, 255, 127);
    imagefilledrectangle($newImage, 0, 0, $newWidth, $newHeight, $transparent);
}

// Perform resize
imagecopyresampled($newImage, $sourceImage, 0, 0, 0, 0, $newWidth, $newHeight, $origWidth, $origHeight);

// Save image
$success = false;
switch ($imageType) {
    case IMAGETYPE_JPEG:
        $success = imagejpeg($newImage, $destination, 85); // 85% quality
        break;
    case IMAGETYPE_PNG:
        $success = imagepng($newImage, $destination, 8); // compression level 8
        break;
    case IMAGETYPE_WEBP:
        $success = imagewebp($newImage, $destination, 85); // 85% quality
        break;
}

// Free memory
imagedestroy($sourceImage);
imagedestroy($newImage);

if ($success) {
    try {
        // Fetch current photo to delete it if exists
        $stmt = $pdo->prepare("SELECT photo_filename FROM taubennester WHERE id = ?");
        $stmt->execute([$nestId]);
        $nest = $stmt->fetch();

        if ($nest && $nest['photo_filename']) {
            $oldFilePath = $uploadDir . $nest['photo_filename'];
            if (file_exists($oldFilePath)) {
                unlink($oldFilePath);
            }
        }

        // Update database
        $stmt = $pdo->prepare("UPDATE taubennester SET photo_filename = ? WHERE id = ?");
        $stmt->execute([$filename, $nestId]);

        // Add log entry
        $logId = bin2hex(random_bytes(18));
        $actionText = 'Foto hinzugefügt';
        $createdAt = date('Y-m-d H:i:s');

        $logStmt = $pdo->prepare("INSERT INTO taubennest_logs (id, nest_id, user_id, action, timestamp) VALUES (?, ?, ?, ?, ?)");
        $logStmt->execute([
            $logId,
            $nestId,
            $currentUser['id'],
            $actionText,
            $createdAt
        ]);

        app_log($pdo, 'info', 'api/upload_nest_photo', 'Foto hochgeladen', [
            'nest_id' => $nestId,
            'filename' => $filename,
            'dimensions' => "{$newWidth}x{$newHeight}"
        ], $currentUser['id']);

        echo json_encode([
            'success' => true,
            'photo_filename' => $filename,
            'message' => 'Photo uploaded successfully'
        ]);
    } catch (Exception $e) {
        app_log($pdo, 'error', 'api/upload_nest_photo', 'Datenbankfehler nach Foto-Upload', [
            'exception' => $e->getMessage(),
            'nest_id' => $nestId
        ], $currentUser['id']);
        http_response_code(500);
        echo json_encode(['error' => 'Database error: ' . $e->getMessage()]);
    }
} else {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to process and save uploaded file']);
}
?>