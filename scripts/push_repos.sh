#!/bin/bash

# This script pushes git repositories from subdirectories to a new remote destination.
# Usage: ./scripts/push_repos.sh [--archive]
#   --archive: Optional. If specified, the remote repositories will be archived (made read-only) after pushing.
#
# The new remote URL will be: https://github.com/Amadeus-xDLC/{current_folder_name}.{repo_folder_name}

# Parse arguments
ARCHIVE_REPOS=false

for arg in "$@"; do
  case $arg in
    --archive)
      ARCHIVE_REPOS=true
      shift
      ;;
    *)
      # Unknown option
      ;;
  esac
done

# Check if gh cli is installed
if ! command -v gh &> /dev/null; then
    echo "Error: GitHub CLI (gh) is not installed."
    exit 1
fi

# Capture the current folder name as the prefix
PREFIX=$(basename "$PWD")
ORG_NAME="Amadeus-xDLC"

echo "----------------------------------------"
echo "Starting migration script"
echo "Source Folder: $PWD"
echo "Prefix:        $PREFIX"
echo "Target Org:    $ORG_NAME"
if [ "$ARCHIVE_REPOS" = true ]; then
    echo "Mode:          Create, Push, and ARCHIVE"
else
    echo "Mode:          Create and Push"
fi
echo "----------------------------------------"

# Loop over all directories in the current location
for dir in */; do
    # Check if the item is a directory
    if [ -d "$dir" ]; then
        # Remove trailing slash from the directory name
        folder_name=${dir%/}
        
        echo "Processing folder: $folder_name"
        
        # Construct the repo name
        REPO_NAME="${PREFIX}.${folder_name}"
        FULL_REPO_NAME="${ORG_NAME}/${REPO_NAME}"
        
        # Navigate into the repository directory
        if cd "$folder_name"; then
            # Check if it is a valid git repository
            if [ -d ".git" ]; then
                echo "  -> Found git repository"
                
                # Create the repository using gh cli
                echo "  -> Creating repository $FULL_REPO_NAME on GitHub..."
                
                # Try to create and push
                if gh repo create "$FULL_REPO_NAME" --private --source=. --remote=origin --push; then
                     echo "  -> Successfully created and pushed $FULL_REPO_NAME"
                else
                     echo "  -> Failed to create/push $FULL_REPO_NAME using 'gh repo create' (it might already exist or permission denied)"
                     # Fallback logic
                     TARGET_URL="https://github.com/${FULL_REPO_NAME}.git"
                     echo "  -> Attempting manual push to $TARGET_URL"
                     
                     if git remote | grep -q "^origin$"; then
                        git remote set-url origin "$TARGET_URL"
                     else
                        git remote add origin "$TARGET_URL"
                     fi
                     
                     git push -u origin --all
                     git push -u origin --tags
                fi
                
                # Optional: Archive the repository
                if [ "$ARCHIVE_REPOS" = true ]; then
                    echo "  -> Archiving repository $FULL_REPO_NAME..."
                    if gh repo archive "$FULL_REPO_NAME" --yes; then
                        echo "  -> Repository archived successfully."
                    else
                        echo "  -> Failed to archive repository."
                    fi
                fi
                
                echo "  -> Complete for $folder_name"
            else
                echo "  -> Skipping: Not a git repository (no .git folder found)"
            fi
            
            # Return to the previous directory
            cd ..
        else
            echo "  -> Error: Could not access directory $folder_name"
        fi
        echo "----------------------------------------"
    fi
done

echo "All tasks finished."
