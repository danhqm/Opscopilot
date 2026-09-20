ALTER TABLE `documents`
  ADD COLUMN `mime_type` VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
  ADD COLUMN `size_bytes` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN `chunk_count` INT UNSIGNED NULL,
  ADD COLUMN `processed_at` DATETIME(3) NULL;
