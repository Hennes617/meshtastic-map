-- Meshtastic payloads can exceed MySQL's default VARCHAR(191) length.
ALTER TABLE `text_messages`
    MODIFY `text` TEXT NOT NULL;
