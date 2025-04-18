# add to ipfs
cid=$(echo '{"signature": {}}' | IPFS_PATH=.ipfs bin/ipfs add --quieter --pin=false)
cid=$(IPFS_PATH=.ipfs bin/ipfs cid base32 $cid)
IPFS_PATH=.ipfs bin/ipfs pin add $cid

curl -v localhost:8000/ipfs/$cid
