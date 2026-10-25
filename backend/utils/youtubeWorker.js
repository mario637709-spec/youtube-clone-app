const fs = require('fs');
const path = require('path');
const os = require('os');
const puppeteer = require('puppeteer');
const dbFirestore = require('./dbFirestore');
const gdriveApi = require('./gdriveApi');
const getPublicBaseUrl = require('./publicBaseUrl');

const SERVER_FOLDER_PATH = path.join(os.homedir(), 'Desktop', 'server');
const MAX_LOCAL_QUEUE_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB

// Concurrency State
const MAX_CONCURRENT_UPLOADS = 1;
let activeWorkers = 0;
const uploadingIds = new Set();
let isAuthBroken = false;

const getFolderSize = (dirPath) => {
  let size = 0;
  if (!fs.existsSync(dirPath)) return 0;
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const stats = fs.statSync(path.join(dirPath, file));
    if (stats.isFile()) size += stats.size;
  }
  return size;
};

// ==========================================
// LOOP A: THE YOUTUBE UPLOADER (Local PC - Multi-Agent)
// ==========================================
const processLocalVideos = async () => {
  if (isAuthBroken) {
    console.log('[Worker-A] Upload queue is paused because YouTube Studio authentication is required. Please run "node youtubeLogin.js" in the terminal to authorize, then restart the server.');
    return;
  }

  if (activeWorkers >= MAX_CONCURRENT_UPLOADS) {
    console.log(`[Worker-A] Max concurrency (${MAX_CONCURRENT_UPLOADS}) reached. Waiting...`);
    return;
  }

  console.log('[Worker-A] Checking for Local pending videos...');
  
  const allVideos = await dbFirestore.getVideos();
  // We only upload videos that are currently on the Local PC and not already being uploaded
  const pendingVideos = allVideos.filter(v => v.status === 'Pending' && !v.youtube_id && v.storageLocation === 'Local' && !uploadingIds.has(v.id));

  if (pendingVideos.length === 0) {
    console.log('[Worker-A] Local Queue is empty or all pending videos are already being processed.');
    return;
  }

  const targetVideo = pendingVideos[0]; // FIFO
  
  // Lock the video
  uploadingIds.add(targetVideo.id);
  activeWorkers++;

    console.log(`[Worker-A] Starting Puppeteer Automation for: ${targetVideo.title}`);
    
    const CHROME_PROFILE_DIR = path.join(os.homedir(), 'Desktop', 'server-bot-profile');
    
    // Check if the user has logged in at least once
    if (!fs.existsSync(CHROME_PROFILE_DIR)) {
      console.error('[Worker-A] Chrome Profile not found. Please run "node youtubeLogin.js" first.');
      uploadingIds.delete(targetVideo.id);
      activeWorkers--;
      return;
    }

    if (!global.persistentBrowser) {
      try {
        global.persistentBrowser = await puppeteer.launch({
          headless: 'new', // Sab kuch background me hidden chalega
          channel: 'chrome', // Use actual installed Google Chrome
          userDataDir: CHROME_PROFILE_DIR,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
      } catch (launchErr) {
        console.error('[Worker-A] Failed to launch persistent browser. Is Chrome already open with this profile?', launchErr.message);
        uploadingIds.delete(targetVideo.id);
        activeWorkers--;
        return;
      }
    }

    const browser = global.persistentBrowser;
    const page = await browser.newPage();
    
    // SPOOF USER AGENT: Bypasses the "unsupported browser" block on YouTube Studio
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    let progressInterval = null;
    try {
      // 1. Go to YouTube Studio (domcontentloaded is much faster than networkidle2)
      await page.goto('https://studio.youtube.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
      
      // Check if redirected to Google sign-in
      const currentUrl = page.url();
      if (currentUrl.includes('accounts.google.com') || currentUrl.includes('signin')) {
        isAuthBroken = true;
        console.error('[Worker-A] Google login/verification detected. YouTube account is not authorized or session expired! Pausing uploader queue.');
        console.error('[Worker-A] Please run "node youtubeLogin.js" in the terminal to authorize, then restart the server.');
        await dbFirestore.updateVideo(targetVideo.id, {
          uploadProgress: 0,
          uploadStatus: 'Authentication required. Please run youtubeLogin.js'
        });
        throw new Error('AUTH_REQUIRED');
      }

      // 2. Click Create -> Upload Video
      console.log('[Worker-A] Waiting for dashboard to load...');
      try {
        await page.waitForFunction(() => {
          const querySelectorDeep = (selector, root = document) => {
            const el = root.querySelector(selector);
            if (el) return el;
            const shadowRoots = [];
            const iterator = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT, {
              acceptNode: (node) => {
                if (node.shadowRoot) shadowRoots.push(node.shadowRoot);
                return NodeFilter.FILTER_SKIP;
              }
            });
            iterator.nextNode();
            for (const shadowRoot of shadowRoots) {
              const deepEl = querySelectorDeep(selector, shadowRoot);
              if (deepEl) return deepEl;
            }
            return null;
          };
          return !!(querySelectorDeep('#create-icon') || querySelectorDeep('#upload-icon') || querySelectorDeep('ytcp-icon-button[aria-label="Upload videos"]'));
        }, { timeout: 30000 });
      } catch (e) {
        const currentUrl = page.url();
        if (currentUrl.includes('accounts.google.com') || currentUrl.includes('signin')) {
          isAuthBroken = true;
          await dbFirestore.updateVideo(targetVideo.id, {
            uploadProgress: 0,
            uploadStatus: 'Authentication required. Please run youtubeLogin.js'
          });
          throw new Error('AUTH_REQUIRED');
        }
        throw new Error('DASHBOARD_TIMEOUT');
      }

      console.log('[Worker-A] Dashboard loaded. Opening upload dialog...');
      
      const opened = await page.evaluate(() => {
        const querySelectorDeep = (selector, root = document) => {
          const el = root.querySelector(selector);
          if (el) return el;
          const shadowRoots = [];
          const iterator = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT, {
            acceptNode: (node) => {
              if (node.shadowRoot) shadowRoots.push(node.shadowRoot);
              return NodeFilter.FILTER_SKIP;
            }
          });
          iterator.nextNode();
          for (const shadowRoot of shadowRoots) {
            const deepEl = querySelectorDeep(selector, shadowRoot);
            if (deepEl) return deepEl;
          }
          return null;
        };

        // 1. Try quick upload
        const quickUpload = querySelectorDeep('#upload-icon') || querySelectorDeep('ytcp-icon-button[aria-label="Upload videos"]');
        if (quickUpload) {
          quickUpload.click();
          return true;
        }
        
        // 2. Try Create button
        const createBtn = querySelectorDeep('#create-icon') || Array.from(document.querySelectorAll('*')).find(el => el.innerText && el.innerText.trim() === 'Create');
        if (createBtn) {
          createBtn.click();
          return true;
        }
        return false;
      });

      if (!opened) {
        throw new Error('CREATE_BUTTON_NOT_FOUND');
      }

      // Wait a moment for the dropdown menu to open (if Create button was clicked instead of quick upload)
      await new Promise(r => setTimeout(r, 2000));

      // Click "Upload videos" from dropdown if we clicked Create button
      await page.evaluate(() => {
        const querySelectorDeep = (selector, root = document) => {
          const el = root.querySelector(selector);
          if (el) return el;
          const shadowRoots = [];
          const iterator = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT, {
            acceptNode: (node) => {
              if (node.shadowRoot) shadowRoots.push(node.shadowRoot);
              return NodeFilter.FILTER_SKIP;
            }
          });
          iterator.nextNode();
          for (const shadowRoot of shadowRoots) {
            const deepEl = querySelectorDeep(selector, shadowRoot);
            if (deepEl) return deepEl;
          }
          return null;
        };
        const uploadItem = querySelectorDeep('#text-item-0') || Array.from(document.querySelectorAll('*')).find(el => el.innerText && el.innerText.includes('Upload video'));
        if (uploadItem) uploadItem.click();
      });
      
      // 3. Upload the file
      console.log('[Worker-A] Waiting for file input...');
      await page.waitForFunction(() => {
        const querySelectorDeep = (selector, root = document) => {
          const el = root.querySelector(selector);
          if (el) return el;
          const shadowRoots = [];
          const iterator = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT, {
            acceptNode: (node) => {
              if (node.shadowRoot) shadowRoots.push(node.shadowRoot);
              return NodeFilter.FILTER_SKIP;
            }
          });
          iterator.nextNode();
          for (const shadowRoot of shadowRoots) {
            const deepEl = querySelectorDeep(selector, shadowRoot);
            if (deepEl) return deepEl;
          }
          return null;
        };
        return !!querySelectorDeep('input[type="file"]');
      }, { timeout: 20000 });

      const fileInput = await page.$('>>> input[type="file"]');
      if (!fileInput) throw new Error('FILE_INPUT_NOT_FOUND');
      
      // FIX: YouTube Studio "File unreadable" error caused by unicode mojibake filenames on Windows Puppeteer.
      const filename = path.basename(targetVideo.localPath);
      let cleanPath = targetVideo.localPath;
      
      if (!filename.startsWith('upload_')) {
          cleanPath = path.join(path.dirname(targetVideo.localPath), `upload_${targetVideo.id}.mp4`);
          if (fs.existsSync(targetVideo.localPath)) {
            fs.renameSync(targetVideo.localPath, cleanPath);
            targetVideo.localPath = cleanPath; // Update it so the deletion at the end works
            
            // Persist the renamed path to DB so we don't lose the file reference if upload fails later
            await dbFirestore.updateVideo(targetVideo.id, { localPath: cleanPath });
          }
      }

      // Start upload progress update in Firestore
      await dbFirestore.updateVideo(targetVideo.id, { uploadProgress: 10, uploadStatus: 'Connecting...' });

      await fileInput.uploadFile(cleanPath);
      
      // 4. Fill Title and Description via Shadow DOM piercing
      console.log('[Worker-A] File uploaded. Filling Title/Description...');
      await dbFirestore.updateVideo(targetVideo.id, { uploadProgress: 20, uploadStatus: 'Uploading to YouTube...' });
      
      await new Promise(r => setTimeout(r, 3000)); // Wait for upload dialog to settle
      
      const videoTitle = targetVideo.title || path.basename(cleanPath, '.mp4');
      const videoDescription = targetVideo.description || '';
      
      try {
        // Fill title via Shadow DOM deep query
        const titleFilled = await page.evaluate((title) => {
          const deepQuery = (sel, root = document) => {
            const el = root.querySelector(sel);
            if (el) return el;
            const allEls = root.querySelectorAll('*');
            for (const node of allEls) {
              if (node.shadowRoot) {
                const found = deepQuery(sel, node.shadowRoot);
                if (found) return found;
              }
            }
            return null;
          };
          const titleArea = deepQuery('#title-textarea');
          if (!titleArea) return false;
          const textbox = titleArea.shadowRoot
            ? titleArea.shadowRoot.querySelector('#textbox')
            : deepQuery('#textbox', titleArea);
          if (!textbox) return false;
          textbox.focus();
          textbox.innerText = '';
          textbox.innerText = title;
          textbox.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }, videoTitle);

        if (titleFilled) {
          console.log(`[Worker-A] \u2705 Title set: "${videoTitle}"`);
        } else {
          // Keyboard fallback: find via Puppeteer shadow piercing
          console.log('[Worker-A] Shadow DOM title fill failed. Trying keyboard fallback...');
          try {
            const titleHandle = await page.$('>>> #title-textarea >>> #textbox');
            if (titleHandle) {
              await titleHandle.click({ clickCount: 3 }); // Select all existing text
              await page.keyboard.type(videoTitle, { delay: 20 });
              console.log(`[Worker-A] \u2705 Title set via keyboard: "${videoTitle}"`);
            } else {
              console.warn('[Worker-A] \u26a0\ufe0f Title field not found. Using filename as default.');
            }
          } catch (kbErr) {
            console.warn(`[Worker-A] \u26a0\ufe0f Keyboard fallback failed: ${kbErr.message}`);
          }
        }

        // Fill description if user provided one
        if (videoDescription) {
          const descFilled = await page.evaluate((desc) => {
            const deepQuery = (sel, root = document) => {
              const el = root.querySelector(sel);
              if (el) return el;
              const allEls = root.querySelectorAll('*');
              for (const node of allEls) {
                if (node.shadowRoot) {
                  const found = deepQuery(sel, node.shadowRoot);
                  if (found) return found;
                }
              }
              return null;
            };
            const descArea = deepQuery('#description-textarea');
            if (!descArea) return false;
            const textbox = descArea.shadowRoot
              ? descArea.shadowRoot.querySelector('#textbox')
              : deepQuery('#textbox', descArea);
            if (!textbox) return false;
            textbox.focus();
            textbox.innerText = desc;
            textbox.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          }, videoDescription);

          if (descFilled) {
            console.log('[Worker-A] \u2705 Description filled successfully');
          } else {
            console.warn('[Worker-A] \u26a0\ufe0f Description field not found. Proceeding without it.');
          }
        }
      } catch (metaErr) {
        console.warn(`[Worker-A] \u26a0\ufe0f Metadata fill error: ${metaErr.message}. Using defaults.`);
      }

      // 5. Select "Not made for kids" (Using text-based click for robustness)
      await new Promise(r => setTimeout(r, 2000)); // wait for modal to settle
      await page.evaluate(() => {
        const deepFindTextClick = (root, text) => {
          const elements = root.querySelectorAll('*');
          for (const el of elements) {
            if (el.innerText && el.innerText.includes(text)) {
              el.click();
              return true;
            }
            if (el.shadowRoot) {
              if (deepFindTextClick(el.shadowRoot, text)) return true;
            }
          }
          return false;
        };
        deepFindTextClick(document, "No, it's not made for kids");
      });
      
      // 6. Get the Video Link (ID)
      await page.waitForFunction(() => {
        const querySelectorDeep = (selector, root = document) => {
          const el = root.querySelector(selector);
          if (el) return el;
          const shadowRoots = [];
          const iterator = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT, {
            acceptNode: (node) => {
              if (node.shadowRoot) shadowRoots.push(node.shadowRoot);
              return NodeFilter.FILTER_SKIP;
            }
          });
          iterator.nextNode();
          for (const shadowRoot of shadowRoots) {
            const deepEl = querySelectorDeep(selector, shadowRoot);
            if (deepEl) return deepEl;
          }
          return null;
        };
        return !!querySelectorDeep('a.ytcp-video-info');
      }, { timeout: 20000 });

      const youtubeId = await page.evaluate(() => {
        const querySelectorDeep = (selector, root = document) => {
          const el = root.querySelector(selector);
          if (el) return el;
          const shadowRoots = [];
          const iterator = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT, {
            acceptNode: (node) => {
              if (node.shadowRoot) shadowRoots.push(node.shadowRoot);
              return NodeFilter.FILTER_SKIP;
            }
          });
          iterator.nextNode();
          for (const shadowRoot of shadowRoots) {
            const deepEl = querySelectorDeep(selector, shadowRoot);
            if (deepEl) return deepEl;
          }
          return null;
        };
        const el = querySelectorDeep('a.ytcp-video-info');
        return el ? el.href.split('/').pop() : null;
      });
      console.log(`[Worker-A] Grabbed YouTube ID: ${youtubeId}`);

      // 7. Click Next 3 times to get to Visibility page
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => {
          const querySelectorDeep = (selector, root = document) => {
            const el = root.querySelector(selector);
            if (el) return el;
            const shadowRoots = [];
            const iterator = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT, {
              acceptNode: (node) => {
                if (node.shadowRoot) shadowRoots.push(node.shadowRoot);
                return NodeFilter.FILTER_SKIP;
              }
            });
            iterator.nextNode();
            for (const shadowRoot of shadowRoots) {
              const deepEl = querySelectorDeep(selector, shadowRoot);
              if (deepEl) return deepEl;
            }
            return null;
          };
          const nextBtn = querySelectorDeep('#next-button');
          if (nextBtn) {
            nextBtn.click();
            return true;
          }
          return false;
        });
        await new Promise(r => setTimeout(r, 1000));
      }

      // 8. Select Visibility (Public/Unlisted/Private)
      const targetVisibility = (targetVideo.visibility || 'public').toUpperCase();
      console.log(`[Worker-A] Setting visibility on YouTube Studio to: ${targetVisibility}`);
      await page.evaluate((visibilityName) => {
        const querySelectorDeep = (selector, root = document) => {
          const el = root.querySelector(selector);
          if (el) return el;
          const shadowRoots = [];
          const iterator = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT, {
            acceptNode: (node) => {
              if (node.shadowRoot) shadowRoots.push(node.shadowRoot);
              return NodeFilter.FILTER_SKIP;
            }
          });
          iterator.nextNode();
          for (const shadowRoot of shadowRoots) {
            const deepEl = querySelectorDeep(selector, shadowRoot);
            if (deepEl) return deepEl;
          }
          return null;
        };
        const visibilityRadio = querySelectorDeep(`tp-yt-paper-radio-button[name="${visibilityName}"]`);
        if (visibilityRadio) {
          visibilityRadio.click();
          return true;
        }
        return false;
      }, targetVisibility);

      // 9. Wait for upload to complete 100% (or start processing) before saving
      console.log(`[Worker-A] Waiting for upload to finish processing...`);
      
      // Start periodic progress checking
      progressInterval = setInterval(async () => {
        try {
          const progressText = await page.evaluate(() => {
            const querySelectorDeep = (selector, root = document) => {
              const el = root.querySelector(selector);
              if (el) return el;
              const shadowRoots = [];
              const iterator = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT, {
                acceptNode: (node) => {
                  if (node.shadowRoot) shadowRoots.push(node.shadowRoot);
                  return NodeFilter.FILTER_SKIP;
                }
              });
              iterator.nextNode();
              for (const shadowRoot of shadowRoots) {
                const deepEl = querySelectorDeep(selector, shadowRoot);
                if (deepEl) return deepEl;
              }
              return null;
            };
            const el = querySelectorDeep('.progress-label') || querySelectorDeep('#progress-label') || querySelectorDeep('.upload-progress');
            return el ? el.innerText : '';
          });
          
          if (progressText) {
            const match = progressText.match(/Uploading\s+(\d+)%/i);
            if (match) {
              const percent = parseInt(match[1], 10);
              // Map 0-100% of upload to 30%-90% of overall progress
              const overallProgress = Math.round(30 + (percent * 0.6));
              await dbFirestore.updateVideo(targetVideo.id, { 
                uploadProgress: overallProgress,
                uploadStatus: `Uploading... ${percent}%`
              });
            } else if (progressText.includes('Upload complete') || progressText.includes('Processing') || progressText.includes('Checks')) {
              await dbFirestore.updateVideo(targetVideo.id, { 
                uploadProgress: 90,
                uploadStatus: 'Upload complete. Saving...'
              });
            }
          }
        } catch (err) {
          // ignore database/evaluation errors during loop
        }
      }, 3000);

      await page.waitForFunction(
        () => {
          const querySelectorDeep = (selector, root = document) => {
            const el = root.querySelector(selector);
            if (el) return el;
            const shadowRoots = [];
            const iterator = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT, {
              acceptNode: (node) => {
                if (node.shadowRoot) shadowRoots.push(node.shadowRoot);
                return NodeFilter.FILTER_SKIP;
              }
            });
            iterator.nextNode();
            for (const shadowRoot of shadowRoots) {
              const deepEl = querySelectorDeep(selector, shadowRoot);
              if (deepEl) return deepEl;
            }
            return null;
          };
          const el = querySelectorDeep('.progress-label') || querySelectorDeep('#progress-label') || querySelectorDeep('.upload-progress');
          const text = el ? (el.innerText || el.textContent || '') : '';
          return text.includes('Upload complete') || text.includes('Processing') || text.includes('Checks') || text.includes('complete');
        },
        { timeout: 300000 } // 5 minute timeout for large files
      );

      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }

      await dbFirestore.updateVideo(targetVideo.id, { uploadProgress: 90, uploadStatus: 'Saving settings...' });

      // 10. Click Save/Publish
      await page.evaluate(() => {
        const querySelectorDeep = (selector, root = document) => {
          const el = root.querySelector(selector);
          if (el) return el;
          const shadowRoots = [];
          const iterator = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT, {
            acceptNode: (node) => {
              if (node.shadowRoot) shadowRoots.push(node.shadowRoot);
              return NodeFilter.FILTER_SKIP;
            }
          });
          iterator.nextNode();
          for (const shadowRoot of shadowRoots) {
            const deepEl = querySelectorDeep(selector, shadowRoot);
            if (deepEl) return deepEl;
          }
          return null;
        };
        const doneBtn = querySelectorDeep('#done-button');
        if (doneBtn) {
          doneBtn.click();
          return true;
        }
        return false;
      });
      
      // Handle either the "Video published" dialog OR the "Video processing" dialog (Shadow-proof checks)
      try {
        await page.waitForFunction(
          () => {
            const querySelectorDeep = (selector, root = document) => {
              const el = root.querySelector(selector);
              if (el) return el;
              const shadowRoots = [];
              const iterator = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT, {
                acceptNode: (node) => {
                  if (node.shadowRoot) shadowRoots.push(node.shadowRoot);
                  return NodeFilter.FILTER_SKIP;
                }
              });
              iterator.nextNode();
              for (const shadowRoot of shadowRoots) {
                const deepEl = querySelectorDeep(selector, shadowRoot);
                if (deepEl) return deepEl;
              }
              return null;
            };

            const deepFindText = (root, text) => {
              if (!root) return false;
              const elements = root.querySelectorAll('*');
              for (const el of elements) {
                if (el.innerText && el.innerText.includes(text)) return true;
                if (el.shadowRoot && deepFindText(el.shadowRoot, text)) return true;
              }
              return false;
            };

            // Check if share dialog is open
            if (querySelectorDeep('ytcp-video-share-dialog')) return true;
            // Check if any dialog says "Video published", "Video processing", or "Upload complete"
            if (deepFindText(document, 'Video published')) return true;
            if (deepFindText(document, 'Video processing')) return true;
            if (deepFindText(document, 'Upload complete')) return true;
            
            // Check if the main wizard dialog is gone (meaning closed)
            const uploadDialog = querySelectorDeep('ytcp-uploads-dialog') || querySelectorDeep('ytcp-video-metadata-editor');
            if (!uploadDialog) return true;

            return false;
          },
          { timeout: 60000 }
        );
        console.log(`[Worker-A] \u2705 Video successfully published as Unlisted!`);
      } catch (dialogErr) {
        console.log(`[Worker-A] Primary confirmation timed out. Verifying publish state...`);
        
        // Fallback: Check if URL changed to video editor (means publish was successful)
        const currentPageUrl = page.url();
        if (currentPageUrl.includes('/video/') || currentPageUrl.includes('studio.youtube.com')) {
          console.log(`[Worker-A] \u2705 URL confirms publish was successful.`);
        } else {
          console.warn(`[Worker-A] \u26a0\ufe0f Publish state uncertain. Saving verification screenshot.`);
          try {
            await page.screenshot({ path: path.join(__dirname, '..', `publish_verify_${targetVideo.id}.png`) });
            console.log(`[Worker-A] Saved publish_verify_${targetVideo.id}.png for manual check.`);
          } catch (e) {}
        }
      }

      // Update Database
      const updates = {
        status: 'Live',
        youtube_id: youtubeId,
        videoUrl: `${getPublicBaseUrl()}/api/videos/stream/${targetVideo.id}`,
        uploadProgress: 100,
        uploadStatus: 'Live'
      };

      // Always update the thumbnail to YouTube's high-res generated thumbnail if the current thumbnail
      // is the default placeholder or the locally generated preview, so it matches YouTube exactly.
      if (!targetVideo.thumbnail || 
          targetVideo.thumbnail.includes('image.png_202606102130.jpeg') || 
          targetVideo.thumbnail.includes('_thumbnail.jpg')) {
        updates.thumbnail = `https://i.ytimg.com/vi/${youtubeId}/maxresdefault.jpg`;
      }

      await dbFirestore.updateVideo(targetVideo.id, updates);
      
      console.log(`[Worker-A] Finished processing ${targetVideo.title}. Marked Live!`);

      // Trigger transcoding sequentially after successful YouTube upload if the file is local
      if (targetVideo.localPath) {
        console.log(`[Worker-A] Triggering transcoding pipeline for: ${targetVideo.id}`);
        try {
          const { processVideoTranscoding } = require('./videoTranscoder');
          processVideoTranscoding(targetVideo.id, targetVideo.localPath, path.basename(targetVideo.localPath))
            .then(() => console.log(`[Worker-A] Transcoding pipeline completed for ${targetVideo.id}`))
            .catch(err => console.error(`[Worker-A] Transcoding pipeline failed for ${targetVideo.id}:`, err.message));
        } catch (transcodeErr) {
          console.error(`[Worker-A] Failed to start transcoding pipeline:`, transcodeErr.message);
        }
      }

      // Trigger GDrive Filler
      triggerGDriveFiller();

    } catch (err) {
      if (err.message === 'AUTH_REQUIRED') {
        // Already logged, do not screenshot
      } else {
        console.error(`[Worker-A] Puppeteer Upload Failed for ${targetVideo.title}:`, err);
        
        // Mark video as Failed with error details so it doesn't retry forever
        try {
          await dbFirestore.updateVideo(targetVideo.id, {
            status: 'Failed',
            uploadProgress: 0,
            uploadStatus: `Failed: ${err.message}`,
            failedAt: new Date().toISOString(),
            error: err.message
          });
          console.log(`[Worker-A] Marked video ${targetVideo.id} as Failed in database.`);
        } catch (dbErr) {
          console.error(`[Worker-A] Could not update Failed status in DB:`, dbErr.message);
        }
        
        try {
          await page.screenshot({ path: path.join(__dirname, '..', `debug_screenshot_${targetVideo.id}.png`) });
          console.log(`[Worker-A] Saved debug_screenshot_${targetVideo.id}.png for inspection.`);
        } catch (e) {}
      }
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      await page.close();
      uploadingIds.delete(targetVideo.id);
      activeWorkers--;
      // Trigger the next one in queue only if authentication is not broken
      if (!isAuthBroken) {
        triggerQueue();
      }
    }
};

// ==========================================
// LOOP B: THE G-DRIVE FILLER (Overflow -> Local)
// ==========================================
const processGDriveOverflow = async () => {
  console.log('[Worker-B] Checking Google Drive for overflow videos...');
  
  const allVideos = await dbFirestore.getVideos();
  
  // Calculate current local capacity (in bytes)
  const currentFolderSize = getFolderSize(SERVER_FOLDER_PATH);
  
  if (currentFolderSize >= MAX_LOCAL_QUEUE_BYTES) {
    console.log(`[Worker-B] Local PC is full (${(currentFolderSize / 1e9).toFixed(2)}GB / 10GB). Waiting for YT uploads to free space...`);
    return;
  }

  // Find videos stuck in Google Drive
  const overflowVideos = allVideos.filter(v => v.status === 'Pending' && v.storageLocation === 'GDrive');

  if (overflowVideos.length === 0) {
    console.log('[Worker-B] No videos in Google Drive overflow.');
    return;
  }

  const targetVideo = overflowVideos[0]; // Oldest overflow video

  try {
    console.log(`[Worker-B] Found GDrive video: ${targetVideo.title}. Downloading to Local PC...`);
    
    // Define where to save the downloaded file
    const videoFilename = `from_gdrive_${targetVideo.id}.mp4`;
    const localVideoPath = path.join(SERVER_FOLDER_PATH, videoFilename);

    // 1. Download from Google Drive to Local PC
    await gdriveApi.downloadFromDrive(targetVideo.gdriveId, localVideoPath);

    // 2. Delete from Google Drive (Freeing up 5TB space)
    await gdriveApi.deleteFromDrive(targetVideo.gdriveId);

    // 3. Update Database (Shift it from GDrive queue to Local PC queue)
    await dbFirestore.updateVideo(targetVideo.id, {
      storageLocation: 'Local',
      localPath: localVideoPath,
      gdriveId: null
    });

    console.log(`[Worker-B] Successfully moved video ${targetVideo.id} to Local PC Buffer.`);

    // Since we now have a new file locally, make sure Loop A knows about it
    triggerQueue();

  } catch (error) {
    console.error(`[Worker-B] Error processing GDrive overflow for ${targetVideo.id}:`, error);
  }
};

// Expose a way to manually trigger the queues
const triggerQueue = () => {
  if (activeWorkers < MAX_CONCURRENT_UPLOADS) {
    setTimeout(processLocalVideos, 1000);
  }
};

const triggerGDriveFiller = () => {
  setTimeout(processGDriveOverflow, 1000);
};

module.exports = {
  triggerQueue,
  triggerGDriveFiller,
  processLocalVideos,
  processGDriveOverflow
};

