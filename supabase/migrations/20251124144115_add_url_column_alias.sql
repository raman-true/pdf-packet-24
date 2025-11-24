/*
  # Add URL Column Support

  1. Changes
    - Add 'url' column as alias/copy of 'file_url' for compatibility with TypeScript code
    - Create trigger to keep both columns in sync

  2. Reasoning
    - TypeScript code expects 'url' field but database has 'file_url'
    - This migration ensures backward compatibility without breaking existing code
*/

-- Add url column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents' AND column_name = 'url'
  ) THEN
    ALTER TABLE documents ADD COLUMN url text;
  END IF;
END $$;

-- Copy existing file_url data to url column
UPDATE documents SET url = file_url WHERE url IS NULL;

-- Create function to sync url and file_url
CREATE OR REPLACE FUNCTION sync_document_urls()
RETURNS TRIGGER AS $$
BEGIN
  -- If url is updated, also update file_url
  IF NEW.url IS DISTINCT FROM OLD.url THEN
    NEW.file_url := NEW.url;
  END IF;

  -- If file_url is updated, also update url
  IF NEW.file_url IS DISTINCT FROM OLD.file_url THEN
    NEW.url := NEW.file_url;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to keep columns in sync
DROP TRIGGER IF EXISTS sync_document_urls_trigger ON documents;
CREATE TRIGGER sync_document_urls_trigger
  BEFORE UPDATE ON documents
  FOR EACH ROW
  EXECUTE FUNCTION sync_document_urls();

-- Set url to be NOT NULL (same as file_url)
DO $$
BEGIN
  -- First make sure all url values are populated from file_url
  UPDATE documents SET url = file_url WHERE url IS NULL;

  -- Then add NOT NULL constraint if it doesn't exist
  BEGIN
    ALTER TABLE documents ALTER COLUMN url SET NOT NULL;
  EXCEPTION
    WHEN others THEN
      -- Column might already have constraint
      NULL;
  END;
END $$;
